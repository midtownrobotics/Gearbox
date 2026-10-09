import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { type TestUser, teamUsers, userFromCookie } from "./users.ts";

// The Vitest config every worker's tests share: tests run inside the Workers runtime (workerd)
// against local D1/KV/R2 from the worker's wrangler config, with its D1 migrations applied
// (setup.ts), and with other workers replaced by stubs, so a worker is tested on its own.

type ServiceStub = (request: Request) => Response | Promise<Response>;

export type WorkerTestOptions = {
  /** Wrangler config to read bindings from. Default ./wrangler.toml. */
  wranglerConfig?: string;
  /** The D1 binding to apply migrations to, if the worker has one. */
  d1?: string;
  /** Its migrations folder. Default ./src/db/migrations. */
  migrations?: string;
  /** Vars and secrets to set or override (e.g. secrets that only exist in .dev.vars). */
  vars?: Record<string, string>;
  /** Other service bindings to stub, by binding name. G3ID is always the G3ID stub. */
  services?: Record<string, ServiceStub>;
  /** Answers the worker's own outbound fetch() calls (to the internet), instead of the network. */
  outbound?: ServiceStub;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Slack DMs and channel posts apps asked G3ID to send, by team (tests read them back). */
const slackDms = new Map<string, Record<string, string>[]>();
const slackMessages = new Map<string, Record<string, string>[]>();
/** Lines apps added to a team's log (`logTeamChange`), and messages sent to all its admins. */
const teamLogs = new Map<string, Record<string, unknown>[]>();
const adminDms = new Map<string, Record<string, unknown>[]>();

/**
 * G3ID as other workers see it: /auth/me answers for the user in the test cookie (users.ts), like
 * the real one, never reporting admin or mentor for a kiosk PIN session.
 */
export const g3idStub: ServiceStub = async (request) => {
  const url = new URL(request.url);
  // Workers call G3ID at /api (http://g3id/api/auth/me), like its public address.
  url.pathname = url.pathname.replace(/^\/api(?=\/)/, "");
  const user = userFromCookie(request.headers.get("Cookie") ?? "");
  if (url.pathname === "/auth/me") {
    if (!user) return json({ error: "Unauthorized." }, 401);
    const pin = user.sessionType === "pin";
    return json({
      ...user,
      status: "active",
      isAdmin: pin ? false : user.isAdmin,
      isMentor: pin ? false : user.isMentor,
      identities: url.searchParams.get("includeIdentities") === "false" ? [] : user.identities,
    });
  }
  if (url.pathname === "/auth/users") {
    const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
    return json(ids.map((id) => ({ id, displayName: id })));
  }
  if (url.pathname === "/auth/logout") return json({ ok: true });
  // The member list (admins only, like the real one): the standard test users of their team.
  if (url.pathname === "/users") {
    if (!user || user.sessionType === "pin" || !user.isAdmin)
      return json({ error: "Forbidden." }, 403);
    return json(membersOf(user.teamId).map((u) => ({ ...u, status: "active" })));
  }
  if (url.pathname === "/users/attendance-eligible") {
    if (!user) return json({ error: "Unauthorized." }, 401);
    return json({
      users: membersOf(user.teamId)
        .filter((u) => !u.isAdmin || u.isMentor)
        .map(({ id, displayName }) => ({ id, displayName })),
    });
  }
  // A team's members with their roles, for other workers over the service binding (the platform
  // SDK's teamMembers). Any team's: the standard users, with ids of their own.
  const members = url.pathname.match(/^\/internal\/teams\/([^/]+)\/members$/);
  if (members) {
    return json(
      membersOf(decodeURIComponent(members[1])).map(
        ({ id, displayName, email, isAdmin, isMentor }) => ({
          id,
          displayName,
          email,
          status: "active",
          isAdmin,
          isMentor,
        }),
      ),
    );
  }
  // A DM or channel post from the team's Slack bot: recorded, never sent. Tests read them back
  // (stub only) with GET /api/internal/teams/:id/slack/dms or .../slack/messages on env.G3ID.
  const slack = url.pathname.match(/^\/internal\/teams\/([^/]+)\/slack\/(dm|message)s?$/);
  if (slack) {
    const store = slack[2] === "dm" ? slackDms : slackMessages;
    const teamId = decodeURIComponent(slack[1]);
    if (request.method === "GET") return json(store.get(teamId) ?? []);
    const body = (await request.json()) as Record<string, string>;
    store.set(teamId, [...(store.get(teamId) ?? []), body]);
    return json({ ok: true });
  }
  // A line for the team's log (`logTeamChange`), or a message to every admin (the platform, when
  // an app is switched on or off): recorded. Tests read them back (stub only) with a GET to the
  // same path on env.G3ID.
  const team = url.pathname.match(/^\/internal\/teams\/([^/]+)\/(audit|slack\/dm-admins)$/);
  if (team) {
    const store = team[2] === "audit" ? teamLogs : adminDms;
    const teamId = decodeURIComponent(team[1]);
    if (request.method === "GET") return json(store.get(teamId) ?? []);
    const body = (await request.json()) as Record<string, unknown>;
    store.set(teamId, [...(store.get(teamId) ?? []), body]);
    return json({ ok: true });
  }
  return json({ error: `G3ID stub has no ${url.pathname}` }, 404);
};

/** The standard test users in a team (teamUsers: the site's team gets the plain ones). */
function membersOf(teamId: string): TestUser[] {
  const team = teamUsers(teamId);
  return [team.student, team.otherStudent, team.mentor, team.admin];
}

/** A service that's down (e.g. the shop's edge box), for workers that must cope with that. */
export const offlineService: ServiceStub = () => json({ error: "Service unavailable." }, 503);

export function workerTestConfig(options: WorkerTestOptions = {}) {
  return defineConfig(async () => {
    // Wrangler skips migrations that are only comments (some workers have placeholder ones);
    // the test helper would fail on them, so they're dropped here.
    const migrations = options.d1
      ? (await readD1Migrations(options.migrations ?? "./src/db/migrations")).map((m) => ({
          ...m,
          queries: m.queries.filter((q) => q.replace(/--[^\n]*/g, "").trim() !== ""),
        }))
      : [];
    return {
      plugins: [
        cloudflareTest({
          // Everything local: no Cloudflare account needed (CI has none).
          remoteBindings: false,
          wrangler: { configPath: options.wranglerConfig ?? "./wrangler.toml" },
          miniflare: {
            bindings: {
              ...options.vars,
              TEST_D1_BINDING: options.d1 ?? "",
              TEST_MIGRATIONS: migrations,
            },
            serviceBindings: { G3ID: g3idStub, ...options.services },
            ...(options.outbound ? { outboundService: options.outbound } : {}),
          },
        }),
      ],
      test: {
        include: ["test/**/*.test.ts"],
        setupFiles: [fileURLToPath(new URL("./setup.ts", import.meta.url))],
        // CI's runners are a few times slower than a dev machine, and a two-team isolation test
        // makes a few hundred requests; 5 s (Vitest's default) isn't always enough there.
        testTimeout: 30_000,
      },
    };
  });
}
