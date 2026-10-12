import { workerTestConfig } from "@g3/testing/config";

// Slack's API as G3ID's tests see it: installing (oauth.v2.access) answers for the workspace named
// in the code ("ws:T123"), its channels are three made-up ones, and messages go nowhere.
const slack = (request: Request) => {
  const url = new URL(request.url);
  if (url.hostname !== "slack.com") return new Response("Not stubbed", { status: 502 });
  if (url.pathname === "/api/oauth.v2.access") {
    return request.formData().then((form) => {
      const code = String(form.get("code") ?? "");
      if (!code.startsWith("ws:")) return Response.json({ ok: false, error: "invalid_code" });
      const id = code.slice(3);
      return Response.json({
        ok: true,
        access_token: `xoxb-${id}`,
        bot_user_id: "UBOT",
        team: { id, name: `Workspace ${id}` },
      });
    });
  }
  if (url.pathname === "/api/users.info") {
    const user = url.searchParams.get("user");
    return Response.json({
      ok: true,
      user: { real_name: `Member ${user}`, profile: { email: `${user}@slack.test` } },
    });
  }
  // A bot installed before it could read channels ("xoxb-old") is refused.
  if (url.pathname === "/api/conversations.list") {
    if (request.headers.get("Authorization") === "Bearer xoxb-old") {
      return Response.json({ ok: false, error: "missing_scope" });
    }
    return Response.json({
      ok: true,
      channels: [
        { id: "C0000000002", name: "shop", is_private: false, is_member: false },
        { id: "C0000000001", name: "announcements", is_private: false, is_member: true },
        { id: "G0000000003", name: "mentors", is_private: true, is_member: true },
      ],
    });
  }
  if (url.pathname === "/api/conversations.open") {
    return Response.json({ ok: true, channel: { id: "D1", is_im: true } });
  }
  return Response.json({ ok: true });
};

// The platform, for the team's log (src/lib/team-log.ts): records each line by team, read back
// with GET /api/internal/teams/:id/audit.
const logged = new Map<string, unknown[]>();
const platform = async (request: Request) => {
  const team = new URL(request.url).pathname.match(/^\/api\/internal\/teams\/([^/]+)\/audit$/);
  if (!team) return Response.json({ error: "Not stubbed" }, { status: 404 });
  const id = decodeURIComponent(team[1]);
  if (request.method === "GET") return Response.json(logged.get(id) ?? []);
  logged.set(id, [...(logged.get(id) ?? []), await request.json()]);
  return Response.json({ ok: true });
};

export default workerTestConfig({
  d1: "DB",
  vars: {
    // Slack app settings, and a key for the secrets kept in D1 (32 zero bytes).
    SLACK_CLIENT_ID: "test-client",
    SLACK_CLIENT_SECRET: "test-secret",
    SLACK_SIGNING_SECRET: "test-signing-secret",
    SLACK_BOT_TOKEN: "xoxb-site",
    SECRETS_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    // Production addresses for other teams, not the dev gateway's.
    LOCAL_GATEWAY_URL: "",
  },
  services: { PLATFORM: platform },
  outbound: slack,
});
