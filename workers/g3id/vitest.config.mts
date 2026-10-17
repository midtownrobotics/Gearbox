import { workerTestConfig } from "@g3/testing/config";
import { fakeDiscord } from "@g3/testing/discord";

const sent: { channel: string; text: string }[] = [];

// Slack's API as G3ID's tests see it: installing (oauth.v2.access) answers for the workspace named
// in the code ("ws:T123"), its channels are three made-up ones, and messages go nowhere.
const slack = (request: Request) => {
  const url = new URL(request.url);
  // Discord's API: @g3/testing's fake (packages/testing/src/discord.ts).
  if (url.hostname === "discord.com") return fakeDiscord(request);
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
  // A DM opens a channel named after the person ("D-U123"); each message is recorded, and a GET
  // of /__sent gives them back.
  if (url.pathname === "/api/conversations.open") {
    return request.json().then((body) => {
      const { users } = body as { users: string };
      return Response.json({ ok: true, channel: { id: `D-${users}`, is_im: true } });
    });
  }
  if (url.pathname === "/api/chat.postMessage") {
    return request.json().then((body) => {
      sent.push(body as { channel: string; text: string });
      return Response.json({ ok: true });
    });
  }
  if (url.pathname === "/__sent") return Response.json(sent);
  return Response.json({ ok: true });
};

// The platform, for the team's log (src/lib/team-log.ts): records each line by team, read back
// with GET /api/internal/teams/:id/audit. And the registry's name for a team (renameTeam in
// src/lib/team-ui.ts), read back with GET /api/internal/teams/:id/name.
const logged = new Map<string, unknown[]>();
const names = new Map<string, unknown>();
const platform = async (request: Request) => {
  const path = new URL(request.url).pathname;
  const named = path.match(/^\/api\/internal\/teams\/([^/]+)\/name$/);
  if (named) {
    const id = decodeURIComponent(named[1]);
    if (request.method === "GET") return Response.json(names.get(id) ?? null);
    names.set(id, ((await request.json()) as { name: unknown }).name);
    return Response.json({ ok: true });
  }
  const team = path.match(/^\/api\/internal\/teams\/([^/]+)\/audit$/);
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
    // The Discord app's settings (one app for every team).
    DISCORD_CLIENT_ID: "test-discord-client",
    DISCORD_CLIENT_SECRET: "test-discord-secret",
    DISCORD_BOT_TOKEN: "test-discord-bot",
    SECRETS_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    // Production addresses for other teams, not the dev gateway's.
    LOCAL_GATEWAY_URL: "",
  },
  services: { PLATFORM: platform },
  outbound: slack,
});
