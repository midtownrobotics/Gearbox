// Discord's REST API, for G3ID (the only worker that talks to Discord). One Discord app serves
// every team: its bot token is one secret, and a team's connection is just its server (guild) id.
// Everything here is plain HTTPS: no Gateway connection, so the bot never reads messages.

const API = "https://discord.com/api/v10";

/** View channels and send messages: all the bot needs in a team's server. */
export const DISCORD_BOT_PERMISSIONS = String((1n << 10n) | (1n << 11n));
/** Signing someone in: who they are and their email. */
export const DISCORD_SIGN_IN_SCOPES = "identify email";
/** Adding the bot to a server (and signing in the person who adds it). */
export const DISCORD_INSTALL_SCOPES = "bot applications.commands identify email";

/** Discord's longest message. */
export const DISCORD_MESSAGE_LIMIT = 2000;

export type DiscordBindings = { DISCORD_BOT_TOKEN: string };

export type DiscordApp = {
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
};

/** An error Discord answered with: its JSON error code (10004 Unknown Guild, ...) and HTTP status. */
export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
  ) {
    super(`Discord API error ${code || status}: ${message}`);
  }

  /** The bot is no longer in the server (removed, or the server is gone). */
  get serverGone(): boolean {
    return this.code === DISCORD_ERRORS.unknownGuild || this.code === DISCORD_ERRORS.missingAccess;
  }
}

/** Discord's JSON error codes this code checks for. */
export const DISCORD_ERRORS = {
  unknownChannel: 10003,
  unknownGuild: 10004,
  unknownMember: 10007,
  unknownUser: 10013,
  missingAccess: 50001,
  cannotDmUser: 50007,
  missingPermissions: 50013,
} as const;

/** Discord user and channel ids: 17 to 20 digits. */
export const isDiscordId = (id: string) => /^\d{17,20}$/.test(id);

async function call<T>(
  env: DiscordBindings,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
  if (!res.ok) {
    throw new DiscordApiError(res.status, data.code ?? 0, data.message ?? res.statusText);
  }
  return data as T;
}

/**
 * Splits a message into pieces Discord takes (2,000 characters each), at line breaks where it
 * can, so a long summary arrives as several messages in order.
 */
export function splitMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut <= 0) cut = rest.lastIndexOf(" ", limit);
    if (cut <= 0) cut = limit;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[\n ]/, "");
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * Posts to a channel (a server's channel or a DM). Mentions are never pinged (user text can't
 * reach @everyone) and links get no previews.
 */
export async function sendMessage(env: DiscordBindings, channelId: string, text: string) {
  for (const content of splitMessage(text)) {
    await call(env, `/channels/${channelId}/messages`, {
      method: "POST",
      // 4: SUPPRESS_EMBEDS.
      body: { content, allowed_mentions: { parse: [] }, flags: 4 },
    });
  }
}

/** A direct message to a Discord user. They must share a server with the bot. */
export async function sendDM(env: DiscordBindings, userId: string, text: string) {
  if (!isDiscordId(userId)) throw new Error("A valid Discord user ID is required for a DM.");
  const dm = await call<{ id: string }>(env, "/users/@me/channels", {
    method: "POST",
    body: { recipient_id: userId },
  });
  await sendMessage(env, dm.id, text);
}

export type DiscordGuild = { id: string; name: string };

/** The server, if the bot is in it; null when it isn't (removed, or no such server). */
export async function getGuild(
  env: DiscordBindings,
  guildId: string,
): Promise<DiscordGuild | null> {
  try {
    const guild = await call<{ id: string; name: string }>(env, `/guilds/${guildId}`);
    return { id: guild.id, name: guild.name };
  } catch (err) {
    if (err instanceof DiscordApiError && (err.serverGone || err.status === 404)) return null;
    throw err;
  }
}

/** Whether a user is a member of the server (the bot must be in it). */
export async function isGuildMember(
  env: DiscordBindings,
  guildId: string,
  userId: string,
): Promise<boolean> {
  try {
    await call(env, `/guilds/${guildId}/members/${userId}`);
    return true;
  } catch (err) {
    if (err instanceof DiscordApiError && err.code === DISCORD_ERRORS.unknownMember) return false;
    if (err instanceof DiscordApiError && err.code === DISCORD_ERRORS.unknownUser) return false;
    throw err;
  }
}

/** Takes the bot out of a server (a team disconnecting Discord). Fine if it's already gone. */
export async function leaveGuild(env: DiscordBindings, guildId: string) {
  try {
    await call(env, `/users/@me/guilds/${guildId}`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof DiscordApiError && (err.serverGone || err.status === 404)) return;
    throw err;
  }
}

export type DiscordChannel = {
  id: string;
  name: string;
  /** Only some roles can see it. */
  isPrivate: boolean;
  /** The bot can see it and post there. */
  canPost: boolean;
};

type Overwrite = { id: string; type: number; allow: string; deny: string };

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const ADMINISTRATOR = 1n << 3n;

/**
 * The server's text and announcement channels, by name, each with whether the bot can post there
 * (worked out from the bot's roles and the channel's permission overwrites, like Discord does).
 */
export async function listChannels(
  env: DiscordBindings,
  guildId: string,
): Promise<DiscordChannel[]> {
  const [channels, roles, me] = await Promise.all([
    call<{ id: string; name: string; type: number; permission_overwrites?: Overwrite[] }[]>(
      env,
      `/guilds/${guildId}/channels`,
    ),
    call<{ id: string; permissions: string }[]>(env, `/guilds/${guildId}/roles`),
    call<{ id: string }>(env, "/users/@me"),
  ]);
  const member = await call<{ roles: string[] }>(env, `/guilds/${guildId}/members/${me.id}`);
  const rolePerms = new Map(roles.map((r) => [r.id, BigInt(r.permissions)]));
  let base = rolePerms.get(guildId) ?? 0n; // @everyone's role has the server's id.
  for (const role of member.roles) base |= rolePerms.get(role) ?? 0n;

  const can = (overwrites: Overwrite[]) => {
    if (base & ADMINISTRATOR) return true;
    let perms = base;
    const apply = (o: Overwrite | undefined) => {
      if (!o) return;
      perms &= ~BigInt(o.deny);
      perms |= BigInt(o.allow);
    };
    apply(overwrites.find((o) => o.id === guildId));
    let allow = 0n;
    let deny = 0n;
    for (const o of overwrites) {
      if (o.type === 0 && o.id !== guildId && member.roles.includes(o.id)) {
        allow |= BigInt(o.allow);
        deny |= BigInt(o.deny);
      }
    }
    perms = (perms & ~deny) | allow;
    apply(overwrites.find((o) => o.type === 1 && o.id === me.id));
    return (perms & VIEW) === VIEW && (perms & SEND) === SEND;
  };
  const hiddenFromEveryone = (overwrites: Overwrite[]) => {
    const everyone = overwrites.find((o) => o.id === guildId);
    return everyone ? (BigInt(everyone.deny) & VIEW) === VIEW : false;
  };

  return (
    channels
      // 0: text, 5: announcement.
      .filter((c) => c.type === 0 || c.type === 5)
      .map((c) => ({
        id: c.id,
        name: c.name,
        isPrivate: hiddenFromEveryone(c.permission_overwrites ?? []),
        canPost: can(c.permission_overwrites ?? []),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  );
}

/** Where to send someone to sign in with Discord, or to add the bot to their server. */
export function authorizeUrl(
  app: Pick<DiscordApp, "DISCORD_CLIENT_ID">,
  opts: { redirectUri: string; state: string; install?: boolean },
): string {
  const params = new URLSearchParams({
    client_id: app.DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: opts.redirectUri,
    scope: opts.install ? DISCORD_INSTALL_SCOPES : DISCORD_SIGN_IN_SCOPES,
    state: opts.state,
  });
  if (!opts.install) params.set("prompt", "none");
  if (opts.install) {
    params.set("permissions", DISCORD_BOT_PERMISSIONS);
    params.set("integration_type", "0");
  }
  return `https://discord.com/oauth2/authorize?${params}`;
}

export type DiscordUser = {
  id: string;
  /** Their display name, else their username. */
  displayName: string;
  /** Only when Discord has verified it. */
  email: string | null;
};

/**
 * Finishes an authorize: the person who signed in, and the server the bot was added to (only
 * when the authorize added the bot). Null when Discord refused the code.
 */
export async function exchangeCode(
  app: DiscordApp,
  code: string,
  redirectUri: string,
): Promise<{ user: DiscordUser; guild: DiscordGuild | null } | null> {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: app.DISCORD_CLIENT_ID,
      client_secret: app.DISCORD_CLIENT_SECRET,
    }),
  });
  if (!res.ok) return null;
  const token = (await res.json()) as {
    access_token?: string;
    guild?: { id: string; name: string };
  };
  if (!token.access_token) return null;
  const me = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!me.ok) return null;
  const user = (await me.json()) as {
    id: string;
    username: string;
    global_name?: string | null;
    email?: string | null;
    verified?: boolean;
  };
  return {
    user: {
      id: user.id,
      displayName: user.global_name || user.username,
      email: user.verified && user.email ? user.email : null,
    },
    guild: token.guild ? { id: token.guild.id, name: token.guild.name } : null,
  };
}
