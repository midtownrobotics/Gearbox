// Discord's API as workers' tests see it (G3ID's and the platform's `outbound`), with nothing sent
// anywhere. Who and what exists is read off the ids, so a test makes what it needs with
// `snowflake(prefix)`:
// - OAuth codes are "u:<user id>" (signing in) or "u:<user id>:g:<server id>" (adding the bot).
// - A user whose id starts with 7 is in no server; one starting with 6 has no verified email.
// - A server whose id starts with 4 doesn't have the bot (Unknown Guild).
// - A channel whose id starts with 3 is one the bot can't see (Missing Access).
// - Every server has the channels in CHANNELS. DMs and posts are recorded: GET
//   https://discord.com/__sent gives them back as { channel, content }, a DM's channel being
//   "dm-<user id>".

/** A random Discord id (18 digits), starting with `prefix`. */
export function snowflake(prefix = "1"): string {
  let id = prefix;
  while (id.length < 18) id += String(Math.floor(Math.random() * 10));
  return id;
}

export const DISCORD_BOT_ID = "900000000000000009";
const BOT_ROLE = "200000000000000001";
const VIEW = 1 << 10;
const SEND = 1 << 11;

/** Every server's channels: one open, one private the bot's role can see, one it can't post in. */
export const DISCORD_CHANNELS = {
  announcements: "100000000000000001",
  mentors: "100000000000000002",
  shop: "100000000000000003",
};

const sent: { channel: string; content: string }[] = [];

const json = (body: unknown, status = 200) => Response.json(body, { status });
const error = (status: number, code: number, message: string) => json({ code, message }, status);

export async function fakeDiscord(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/v10/, "");
  const auth = request.headers.get("Authorization") ?? "";
  if (path === "/__sent") return json(sent);

  if (path === "/oauth2/token" && request.method === "POST") {
    const code = String((await request.formData()).get("code") ?? "");
    const match = code.match(/^u:(\d+)(?::g:(\d+))?$/);
    if (!match) return error(400, 0, "invalid_grant");
    return json({
      access_token: `at-${match[1]}`,
      token_type: "Bearer",
      ...(match[2] ? { guild: { id: match[2], name: `Server ${match[2]}` } } : {}),
    });
  }
  if (path === "/users/@me" && auth.startsWith("Bearer at-")) {
    const id = auth.slice("Bearer at-".length);
    return json({
      id,
      username: `user${id.slice(-4)}`,
      global_name: `Member ${id.slice(-4)}`,
      email: `${id}@discord.test`,
      verified: !id.startsWith("6"),
    });
  }
  if (!auth.startsWith("Bot ")) return error(401, 0, "401: Unauthorized");

  if (path === "/users/@me") return json({ id: DISCORD_BOT_ID });
  if (path === "/users/@me/channels" && request.method === "POST") {
    const { recipient_id } = (await request.json()) as { recipient_id: string };
    return json({ id: `dm-${recipient_id}`, type: 1 });
  }
  const leave = path.match(/^\/users\/@me\/guilds\/(\d+)$/);
  if (leave && request.method === "DELETE") return new Response(null, { status: 204 });

  const post = path.match(/^\/channels\/([^/]+)\/messages$/);
  if (post && request.method === "POST") {
    const channel = post[1];
    if (channel.startsWith("3")) return error(403, 50001, "Missing Access");
    if (channel.startsWith("4")) return error(404, 10003, "Unknown Channel");
    const { content } = (await request.json()) as { content: string };
    if (content.length > 2000) return error(400, 50035, "Invalid Form Body");
    sent.push({ channel, content });
    return json({ id: snowflake(), channel_id: channel, content });
  }

  const guild = path.match(/^\/guilds\/(\d+)(\/.*)?$/);
  if (guild) {
    const [, id, rest = ""] = guild;
    if (id.startsWith("4")) return error(404, 10004, "Unknown Guild");
    if (rest === "") return json({ id, name: `Server ${id}` });
    if (rest === "/roles") {
      return json([
        { id, name: "@everyone", permissions: String(VIEW | SEND) },
        { id: BOT_ROLE, name: "Gearbox", permissions: "0" },
      ]);
    }
    if (rest === "/channels") {
      return json([
        {
          id: DISCORD_CHANNELS.shop,
          name: "shop",
          type: 0,
          permission_overwrites: [{ id: DISCORD_BOT_ID, type: 1, allow: "0", deny: String(SEND) }],
        },
        { id: DISCORD_CHANNELS.announcements, name: "announcements", type: 0 },
        {
          id: DISCORD_CHANNELS.mentors,
          name: "mentors",
          type: 0,
          permission_overwrites: [
            { id, type: 0, allow: "0", deny: String(VIEW) },
            { id: BOT_ROLE, type: 0, allow: String(VIEW), deny: "0" },
          ],
        },
        { id: "100000000000000004", name: "Voice", type: 2 },
      ]);
    }
    const member = rest.match(/^\/members\/(\d+)$/);
    if (member) {
      if (member[1] === DISCORD_BOT_ID) return json({ roles: [BOT_ROLE] });
      if (member[1].startsWith("7")) return error(404, 10007, "Unknown Member");
      return json({ roles: [], user: { id: member[1] } });
    }
  }
  return error(404, 0, `Fake Discord has no ${request.method} ${path}`);
}
