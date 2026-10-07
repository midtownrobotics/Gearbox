import { type TeamUsers, type TestUser, asUser, newTeamId, teamUsers } from "./users";
import { call } from "./worker";

// The two-team isolation test every app must pass (roadmap Phase 3, and every variant in Phase 6).
// Two teams get their own data; then every route the app has is called as team A's users, with
// team B's ids in the path. It fails if any answer contains something only B has, or if B's rows
// are any different afterwards.

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
