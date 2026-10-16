import { type TeamUsers, type TestUser, asUser, newTeamId, teamUsers } from "./users";
import { call } from "./worker";

// The two-team isolation test every app must pass (roadmap Phase 3, and every variant in Phase 6).
// Two teams get their own data; then every route the app has is called as team A's users, with
// team B's ids in the path. It fails if any answer contains something only B has, or if B's rows
// are any different afterward.

export type Seeded = {
  /**
   * Values for route parameters: by name (`{ userId: "…" }`), or from the route's path and the
   * name, for an app whose routes share a name (`/trees/:id` and `/skills/:id`).
   */
  params: Record<string, string> | ((path: string, name: string) => string | undefined);
  /** Strings that appear only in this team's data (names made for the test). */
  markers: string[];
  /** Anything else the bodies need (the team's ids). */
  data?: Record<string, unknown>;
};

export type IsolationSpec = {
  /** The app's Hono app (its `routes`, as Hono lists them). */
  app: { routes: { method: string; path: string }[] };
  /** Gives a team its data, through the app's own routes or its database. */
  seed(team: TeamUsers): Promise<Seeded>;
  /** Everything the team has, to compare before and after (rows from its tables). */
  snapshot(teamId: string): Promise<unknown>;
  /** Request bodies by route ("POST /trees"), made from team B's data; `{}` otherwise. */
  bodies?: (b: Seeded) => Record<string, unknown>;
  /** Routes that can't be called this way ("GET /health"), each with the reason in a comment. */
  skip?: string[];
  /** Team A's users to call as (default: admin, mentor, student, kiosk admin). */
  callers?: (team: TeamUsers) => TestUser[];
};

export type IsolationResult = {
  /** Requests made: routes × callers. */
  requests: number;
  /** What went wrong, one line each; empty when the app keeps teams apart. */
  problems: string[];
};

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** Every route of the app, once each ("GET /trees/:id"). */
export function routesOf(app: IsolationSpec["app"]) {
  const seen = new Set<string>();
  const routes: { method: string; path: string }[] = [];
  for (const { method, path } of app.routes) {
    if (!METHODS.has(method) || path.includes("*")) continue;
    // Only other workers reach /internal (the gateway never answers it): checkTeamDeletion tests it.
    if (path === "/internal" || path.startsWith("/internal/")) continue;
    const key = `${method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ method, path });
  }
  return routes;
}

/** Fills `:name` parameters from the team's values (and "1" for any it hasn't got). */
function fill(path: string, params: Seeded["params"]) {
  const value = (name: string) =>
    (typeof params === "function" ? params(path, name) : params[name]) ?? "1";
  return path.replace(/:(\w+)(\{[^}]*\})?/g, (_, name: string) => encodeURIComponent(value(name)));
}

export async function checkIsolation(spec: IsolationSpec): Promise<IsolationResult> {
  const a = teamUsers(newTeamId());
  const b = teamUsers(newTeamId());
  await spec.seed(a);
  const seededB = await spec.seed(b);
  const before = JSON.stringify(await spec.snapshot(b.teamId));

  const callers = spec.callers?.(a) ?? [a.admin, a.mentor, a.student, a.kioskAdmin];
  const skip = new Set(spec.skip ?? []);
  const bodies = spec.bodies?.(seededB) ?? {};
  const problems: string[] = [];
  let requests = 0;
  for (const route of routesOf(spec.app)) {
    const key = `${route.method} ${route.path}`;
    if (skip.has(key)) continue;
    const path = fill(route.path, seededB.params);
    const body = route.method === "GET" ? undefined : (bodies[key] ?? {});
    for (const caller of callers) {
      requests++;
      const res = await call(path, asUser(caller, { method: route.method, body }));
      const text = await res.text();
      for (const marker of seededB.markers) {
        if (text.includes(marker)) {
          problems.push(`${key} as ${caller.id} (${res.status}) shows team B's "${marker}"`);
        }
      }
      if (JSON.stringify(await spec.snapshot(b.teamId)) !== before) {
        problems.push(`${key} as ${caller.id} (${res.status}) changed team B's data`);
        return { requests, problems };
      }
    }
  }
  return { requests, problems };
}

export type DeletionSpec = Pick<IsolationSpec, "seed" | "snapshot"> & {
  /** Calls the app as the platform does when an operator deletes the team. */
  remove(teamId: string): Promise<Response>;
  /** What's left of a deleted team that's fine (its snapshot after), as a predicate. */
  isEmpty?: (snapshot: unknown) => boolean;
};

/** Every value in a snapshot is an empty list (or an object of them). */
export function emptySnapshot(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === "object") return Object.values(value).every(emptySnapshot);
  return true;
}

/**
 * Deleting a team's data (`DELETE /internal/teams/:teamId`) leaves nothing of it and doesn't touch
 * another team's. Gives back what went wrong, one line each.
 */
export async function checkTeamDeletion(spec: DeletionSpec): Promise<string[]> {
  const a = teamUsers(newTeamId());
  const b = teamUsers(newTeamId());
  await spec.seed(a);
  await spec.seed(b);
  const before = JSON.stringify(await spec.snapshot(b.teamId));
  const problems: string[] = [];
  const res = await spec.remove(a.teamId);
  if (!res.ok) problems.push(`deleting team A answered ${res.status}: ${await res.text()}`);
  const left = await spec.snapshot(a.teamId);
  if (!(spec.isEmpty ?? emptySnapshot)(left)) {
    problems.push(`team A still has: ${JSON.stringify(left).slice(0, 500)}`);
  }
  if (JSON.stringify(await spec.snapshot(b.teamId)) !== before) {
    problems.push("deleting team A changed team B's data");
  }
  // Deleting a team with nothing left (a retry) is fine too.
  const again = await spec.remove(a.teamId);
  if (!again.ok) problems.push(`deleting it again answered ${again.status}`);
  return problems;
}

export type ExportSpec = Pick<IsolationSpec, "seed"> & {
  /** Calls the app as the platform does when an admin downloads its data. */
  exportOf(teamId: string): Promise<Response>;
  /** Strings a team's export must never contain (its secrets, as the test saved them). */
  secrets?: (team: Seeded) => string[];
};

/**
 * A team's export (`GET /internal/teams/:teamId/export`) is its data and only its data: it answers
 * in the platform's format, has team A's markers, none of team B's, and none of the secrets the
 * test gave. Gives back what went wrong, one line each.
 */
export async function checkTeamExport(spec: ExportSpec): Promise<string[]> {
  const a = teamUsers(newTeamId());
  const b = teamUsers(newTeamId());
  const seededA = await spec.seed(a);
  const seededB = await spec.seed(b);
  const problems: string[] = [];
  const res = await spec.exportOf(a.teamId);
  if (!res.ok) return [`exporting team A answered ${res.status}: ${await res.text()}`];
  const text = await res.text();
  let body: { format?: unknown; teamId?: unknown; tables?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return ["the export isn't JSON"];
  }
  if (body.format !== "gearbox-team-export")
    problems.push("the export isn't a gearbox-team-export");
  if (body.teamId !== a.teamId) problems.push(`the export is for ${String(body.teamId)}`);
  if (!body.tables || typeof body.tables !== "object") problems.push("the export has no tables");
  if (!seededA.markers.some((marker) => text.includes(marker))) {
    problems.push("team A's export has none of team A's data");
  }
  for (const marker of seededB.markers) {
    if (text.includes(marker)) problems.push(`team A's export has team B's "${marker}"`);
  }
  for (const secret of spec.secrets?.(seededA) ?? []) {
    if (text.includes(secret)) problems.push(`the export has a secret ("${secret.slice(0, 6)}…")`);
  }
  return problems;
}
