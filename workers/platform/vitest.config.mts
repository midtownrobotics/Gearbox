import { g3idStub, workerTestConfig } from "@g3/testing/config";
import { fakeDiscord } from "@g3/testing/discord";

// G3ID's internal routes, as the platform uses them: it accepts teams and workspaces (one
// workspace, TTAKEN, is already another team's), and hands out codes. A code is pending the first
// time it's checked, and sent by its founder ("u-founder") after that.
// For the operators' console: every team has two members, its founder ("u-founder", who has
// linked the team's chat) and "u-member"; chat posts and DMs to a team are recorded (GET the
// same path);
// any account exists except "u-nobody"; deleting and handing over a team work; and /stats gives
// fixed member counts.
// /auth/me is the usual test stub (@g3/testing).
const checks = new Map<string, number>();
/** Messages to every admin of a team (the app library's), by team: read back with a GET. */
const adminDms = new Map<string, { text: string }[]>();
/** Chat posts and member DMs (notifications), by team and path: read back with a GET. */
const slackSent = new Map<string, unknown[]>();
const MEMBERS = [
  {
    id: "u-founder",
    displayName: "Fay Founder",
    email: "fay@test",
    status: "active",
    isAdmin: true,
    hasChat: true,
  },
  {
    id: "u-member",
    displayName: "Max Member",
    email: "max@test",
    status: "active",
    isAdmin: false,
    hasChat: false,
  },
];
const g3id = async (request: Request) => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/internal/")) return g3idStub(request);
  const path = url.pathname.replace(/^\/api\/internal/, "");
  if (path === "/teams") return Response.json({ ok: true });
  if (path === "/stats") {
    return Response.json({
      active: 12,
      pending: 2,
      mentors: 3,
      online: 1,
      activeWeek: 8,
      activeMonth: 10,
      joinedMonth: 4,
    });
  }
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
    // A team signed up with Discord: its founder becomes "u-founder", unless they have no
    // verified email.
    if (rest === "/discord-founder") {
      const { user } = (await request.json()) as { user: { email: string | null } };
      return user.email
        ? Response.json({ userId: "u-founder", token: "handoff-token" })
        : Response.json({ error: "Your Discord account has no verified email." }, { status: 409 });
    }
    // The public demo's accounts, made again on its nightly reset.
    if (rest === "/demo/reset" && request.method === "POST") return Response.json({ ok: true });
    if (rest === "/chat/dm-admins") {
      const id = team[1];
      if (request.method === "GET") return Response.json(adminDms.get(id) ?? []);
      const body = (await request.json()) as { text: string };
      adminDms.set(id, [...(adminDms.get(id) ?? []), body]);
      return Response.json({ ok: true, sent: 1, admins: 1 });
    }
    if (rest === "/chat/message" || rest === "/chat/dm-members") {
      const key = `${team[1]}${rest}`;
      if (request.method === "GET") return Response.json(slackSent.get(key) ?? []);
      slackSent.set(key, [...(slackSent.get(key) ?? []), await request.json()]);
      return Response.json({ ok: true });
    }
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

// GitHub's issues on the repository "test/gearbox", for members' reports (src/reports.ts). Tests
// read an issue back with GET /test/issues/:n, close one with POST /test/issues/:n/close?reason=,
// and take GitHub down or up with POST /test/down?on=1|0.
type FakeIssue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  state_reason: string | null;
};
const issues = new Map<number, FakeIssue>();
let githubDown = false;
const github = async (request: Request) => {
  const path = new URL(request.url).pathname;
  const url = new URL(request.url);
  if (path === "/test/down") {
    githubDown = url.searchParams.get("on") === "1";
    return Response.json({ ok: true });
  }
  const test = path.match(/^\/test\/issues\/(\d+)(\/close)?$/);
  if (test) {
    const issue = issues.get(Number(test[1]));
    if (!issue) return Response.json({ message: "Not Found" }, { status: 404 });
    if (test[2]) {
      issue.state = "closed";
      issue.state_reason = url.searchParams.get("reason");
    }
    return Response.json(issue);
  }
  if (githubDown) return Response.json({ message: "Down" }, { status: 503 });
  if (request.headers.get("Authorization") !== "Bearer test-github-token") {
    return Response.json({ message: "Bad credentials" }, { status: 401 });
  }
  if (path === "/repos/test/gearbox/issues" && request.method === "POST") {
    const body = (await request.json()) as { title: string; body: string; labels: string[] };
    const number = issues.size + 1;
    issues.set(number, { number, ...body, state: "open", state_reason: null });
    return Response.json(
      { number, html_url: `https://github.com/test/gearbox/issues/${number}` },
      { status: 201 },
    );
  }
  const one = path.match(/^\/repos\/test\/gearbox\/issues\/(\d+)$/);
  const issue = one && issues.get(Number(one[1]));
  if (issue) return Response.json(issue);
  return Response.json({ message: "Not Found" }, { status: 404 });
};

// Slack's install: answers for the workspace named in the code ("ws:T123").
const slack = async (request: Request) => {
  const url = new URL(request.url);
  if (url.hostname === "api.github.com") return github(request);
  // Discord: @g3/testing's fake (packages/testing/src/discord.ts).
  if (url.hostname === "discord.com") return fakeDiscord(request);
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
 * A team-scoped app's /api/internal/teams/:id: records each team it's asked to delete, seed or
 * load the demo's sample data for (read back with GET /api/internal/deleted, /seeded and
 * /demoed), and fails for a team a test named with POST /api/internal/fail/:id.
 */
function teamApp() {
  const deleted: string[] = [];
  const seeded: string[] = [];
  const demoed: string[] = [];
  const failing = new Set<string>();
  return (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/api/internal/deleted") return Response.json(deleted);
    if (path === "/api/internal/seeded") return Response.json(seeded);
    if (path === "/api/internal/demoed") return Response.json(demoed);
    const demo = path.match(/^\/api\/internal\/teams\/(.+)\/demo$/);
    if (demo && request.method === "POST") {
      demoed.push(decodeURIComponent(demo[1]));
      return Response.json({ ok: true });
    }
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
    const exported = path.match(/^\/api\/internal\/teams\/(.+)\/export$/);
    if (exported && request.method === "GET") {
      return Response.json({
        format: "gearbox-team-export",
        version: 1,
        teamId: decodeURIComponent(exported[1]),
        tables: { rows: [{ marker: "exported" }] },
      });
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
    DISCORD_CLIENT_ID: "test-discord-client",
    DISCORD_CLIENT_SECRET: "test-discord-secret",
    LOCAL_GATEWAY_URL: "",
    GITHUB_REPO: "test/gearbox",
    GITHUB_TOKEN: "test-github-token",
  },
  services: {
    G3ID: g3id,
    ATTENDANCE: teamApp(),
    EDGE: teamApp(),
    INVENTORY: teamApp(),
    ORDERS: teamApp(),
    PIT: teamApp(),
    SCHEDULE: teamApp(),
    SHOP: teamApp(),
    SCOUTING: teamApp(),
    SKILL_TREE: teamApp(),
  },
  outbound: slack,
});
