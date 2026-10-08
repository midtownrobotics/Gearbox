import { g3idStub, workerTestConfig } from "@g3/testing/config";

// G3ID's internal routes, as the platform uses them: it accepts teams and workspaces (one
// workspace, TTAKEN, is already another team's), and hands out codes. A code is pending the first
// time it's checked, and sent by its founder ("u-founder") after that.
// For the operators' console: every team has two members, its founder ("u-founder") and
// "u-member"; any account exists except "u-nobody"; and deleting and handing over a team work.
// /auth/me is the usual test stub (@g3/testing).
const checks = new Map<string, number>();
const MEMBERS = [
  {
    id: "u-founder",
    displayName: "Fay Founder",
    email: "fay@test",
    status: "active",
    isAdmin: true,
  },
  {
    id: "u-member",
    displayName: "Max Member",
    email: "max@test",
    status: "active",
    isAdmin: false,
  },
];
const g3id = async (request: Request) => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/internal/")) return g3idStub(request);
  const path = url.pathname.replace(/^\/api\/internal/, "");
  if (path === "/teams") return Response.json({ ok: true });
  if (path === "/users") {
    const ids = (url.searchParams.get("ids") ?? "").split(",").filter((id) => id !== "u-nobody");
    return Response.json(
      ids.map((id) => ({
        id,
        displayName: `Name of ${id}`,
        email: `${id}@test`,
        teamId: "frc1648",
      })),
    );
  }
  const team = path.match(/^\/teams\/(frc\d+)(\/.*)?$/);
  if (team) {
    const [, , rest] = team;
    if (rest === "/members") return Response.json(MEMBERS);
    if (!rest && request.method === "DELETE") {
      return Response.json({ deletedUserIds: MEMBERS.map((m) => m.id) });
    }
    if (rest === "/owner") {
      const { userId } = (await request.json()) as { userId: string };
      return MEMBERS.some((m) => m.id === userId)
        ? Response.json({ ok: true })
        : Response.json({ error: "That account isn't on this team." }, { status: 404 });
    }
  }
  if (path === "/slack-installations") {
    const body = (await request.json()) as { workspaceId: string };
    return body.workspaceId === "TTAKEN"
      ? Response.json({ result: "taken" }, { status: 409 })
      : Response.json({ result: "saved" });
  }
  if (path === "/signup-codes") {
    const token = crypto.randomUUID();
    checks.set(token, 0);
    return Response.json({ code: "1234", token });
  }
  const token = path.match(/^\/signup-codes\/(.+)$/)?.[1];
  if (token && checks.has(token)) {
    const seen = checks.get(token) ?? 0;
    checks.set(token, seen + 1);
    return Response.json(
      seen === 0 ? { status: "pending" } : { status: "success", userId: "u-founder" },
    );
  }
  if (token) return Response.json({ status: "expired" });
  return Response.json({ error: "Not stubbed" }, { status: 500 });
};

// Slack's install: answers for the workspace named in the code ("ws:T123").
const slack = async (request: Request) => {
  const url = new URL(request.url);
  if (url.hostname === "slack.com" && url.pathname === "/api/oauth.v2.access") {
    const code = String((await request.formData()).get("code") ?? "");
    if (!code.startsWith("ws:")) return Response.json({ ok: false });
    const id = code.slice(3);
    return Response.json({
      ok: true,
      access_token: `xoxb-${id}`,
      bot_user_id: "UBOT",
      team: { id, name: `Workspace ${id}` },
    });
  }
  return new Response("Not stubbed", { status: 502 });
};

/**
 * A team-scoped app's /api/internal/teams/:id: records each team it's asked to delete or seed
 * (read back with GET /api/internal/deleted and /seeded), and fails for a team a test named with
 * POST /api/internal/fail/:id.
 */
function teamApp() {
  const deleted: string[] = [];
  const seeded: string[] = [];
  const failing = new Set<string>();
  return (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/api/internal/deleted") return Response.json(deleted);
    if (path === "/api/internal/seeded") return Response.json(seeded);
    const seed = path.match(/^\/api\/internal\/teams\/(.+)\/seed$/);
    if (seed && request.method === "POST") {
      seeded.push(decodeURIComponent(seed[1]));
      return Response.json({ ok: true });
    }
    const fail = path.match(/^\/api\/internal\/fail\/(.+)$/);
    if (fail) {
      failing.add(decodeURIComponent(fail[1]));
      return Response.json({ ok: true });
    }
    const team = path.match(/^\/api\/internal\/teams\/(.+)$/);
    if (team && request.method === "DELETE") {
      const id = decodeURIComponent(team[1]);
      if (failing.has(id)) return Response.json({ error: "Down." }, { status: 500 });
      deleted.push(id);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Not stubbed" }, { status: 404 });
  };
}

export default workerTestConfig({
  d1: "PLATFORM_DB",
  // Production addresses, not the dev gateway's.
  vars: {
    SLACK_CLIENT_ID: "test-client",
    SLACK_CLIENT_SECRET: "test-secret",
    LOCAL_GATEWAY_URL: "",
  },
  services: {
    G3ID: g3id,
    ATTENDANCE: teamApp(),
    EDGE: teamApp(),
    INVENTORY: teamApp(),
    ORDERS: teamApp(),
    PIT: teamApp(),
    SHOP: teamApp(),
    SKILL_TREE: teamApp(),
  },
  outbound: slack,
});
