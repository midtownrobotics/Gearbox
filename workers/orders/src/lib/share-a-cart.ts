import { decryptSecret, encryptSecret } from "@g3/auth";
import type { OrdersDb } from "../db";
import { deleteSetting, getSetting, putSetting, settingsLike } from "./settings";

// Share-A-Cart (share-a-cart.com) builds shareable Amazon carts (Amazon's own multi-item cart
// link needs an Associates tag). Other stores' Share-A-Cart carts only open with their browser
// extension, and McMaster's don't work at all, so Amazon is the only vendor we use it for. Each
// team connects its own account once over OAuth (dynamic client registration + PKCE, with the
// client, tokens and pending sign-ins kept in the team's settings); carts are then created with
// the `sac_save_cart` tool
// of their MCP server (JSON-RPC over HTTP). Docs: https://share-a-cart.com/developers/docs/tools

const SAC = "https://share-a-cart.com";
const MCP_URL = `${SAC}/mcp`;
const PROTOCOL_VERSION = "2025-06-18";
const KEY_CLIENT = "sac_client";
const KEY_AUTH = "sac_auth";
const PENDING_PREFIX = "sac_pending:";
const PENDING_TTL_MS = 15 * 60_000;

/** Our vendor names → Share-A-Cart vendor ids. Only Amazon: see the note above. */
export const SAC_VENDORS: Record<string, string> = {
  amazon: "amazon",
};

type Client = { redirectUri: string; clientId: string; clientSecret: string | null };
export type SacAuth = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  connectedBy: string;
  connectedAt: number;
};

export class SacError extends Error {}

/** One team's settings, and the worker's key for the secrets in them. */
export type Team = { db: OrdersDb; teamId: string; secretsKey: string | undefined };

// The team's Share-A-Cart client, tokens and pending sign-ins are kept encrypted with the
// worker's SECRETS_KEY (encryptSecret in @g3/auth). Rows saved before that are plain JSON: they're
// still read, and saved again encrypted the first time.

/** A stored value's JSON: decrypted, or as it is for one saved before encryption. */
async function openValue<T>(team: Team, value: string): Promise<{ data: T; plain: boolean }> {
  if (value.startsWith("{")) return { data: JSON.parse(value) as T, plain: true };
  return { data: JSON.parse(await decryptSecret(value, team.secretsKey)) as T, plain: false };
}

async function getJson<T>(team: Team, key: string): Promise<T | null> {
  const value = await getSetting(team.db, team.teamId, key);
  if (value === null) return null;
  const { data, plain } = await openValue<T>(team, value);
  if (plain && team.secretsKey) await putJson(team, key, data);
  return data;
}

async function putJson(team: Team, key: string, value: unknown) {
  const sealed = await encryptSecret(JSON.stringify(value), team.secretsKey);
  await putSetting(team.db, team.teamId, key, sealed);
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

/** Our OAuth client at Share-A-Cart, registered once per redirect URI (dev and production differ). */
async function client(team: Team, redirectUri: string): Promise<Client> {
  const saved = await getJson<Client>(team, KEY_CLIENT);
  if (saved && saved.redirectUri === redirectUri) return saved;
  const res = await fetch(`${SAC}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Gearbox Orders",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "carts",
    }),
  });
  if (!res.ok)
    throw new SacError(`Share-A-Cart refused to register this app (HTTP ${res.status}).`);
  const body = (await res.json()) as { client_id: string; client_secret?: string };
  const created = {
    redirectUri,
    clientId: body.client_id,
    clientSecret: body.client_secret ?? null,
  };
  await putJson(team, KEY_CLIENT, created);
  return created;
}

/** Starts the connection: returns the Share-A-Cart sign-in URL to send the mentor to. */
export async function startConnect(team: Team, redirectUri: string, userName: string) {
  const c = await client(team, redirectUri);
  const state = randomToken();
  const verifier = randomToken();
  const challenge = b64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  // Drop abandoned attempts, then remember this one.
  for (const p of await settingsLike(team.db, team.teamId, PENDING_PREFIX)) {
    const { createdAt } = (await openValue<{ createdAt: number }>(team, p.value)).data;
    if (Date.now() - createdAt > PENDING_TTL_MS) await deleteSetting(team.db, team.teamId, p.key);
  }
  await putJson(team, PENDING_PREFIX + state, { verifier, userName, createdAt: Date.now() });
  const url = new URL(`${SAC}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: c.clientId,
    redirect_uri: redirectUri,
    scope: "carts",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: MCP_URL,
  }).toString();
  return url.toString();
}

async function token(c: Client, params: Record<string, string>) {
  const res = await fetch(`${SAC}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...params,
      client_id: c.clientId,
      ...(c.clientSecret ? { client_secret: c.clientSecret } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new SacError(
      `Share-A-Cart sign-in failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}.`,
    );
  }
  return body as { access_token: string; refresh_token?: string; expires_in?: number };
}

/** Finishes the connection with the code Share-A-Cart sent back. */
export async function finishConnect(team: Team, redirectUri: string, code: string, state: string) {
  const pending = await getJson<{ verifier: string; userName: string; createdAt: number }>(
    team,
    PENDING_PREFIX + state,
  );
  await deleteSetting(team.db, team.teamId, PENDING_PREFIX + state);
  if (!pending || Date.now() - pending.createdAt > PENDING_TTL_MS) {
    throw new SacError("That sign-in link expired. Start connecting again from Settings.");
  }
  const c = await client(team, redirectUri);
  const t = await token(c, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: pending.verifier,
  });
  await putJson(team, KEY_AUTH, {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
    connectedBy: pending.userName,
    connectedAt: Date.now(),
  } satisfies SacAuth);
}

export async function connection(team: Team) {
  return getJson<SacAuth>(team, KEY_AUTH);
}

export async function disconnect(team: Team) {
  const auth = await connection(team);
  const c = await getJson<Client>(team, KEY_CLIENT);
  if (auth?.refreshToken && c) {
    await fetch(`${SAC}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: auth.refreshToken, client_id: c.clientId }),
    }).catch(() => undefined);
  }
  await deleteSetting(team.db, team.teamId, KEY_AUTH);
}

/** A current access token, refreshed when it's about to expire. */
async function accessToken(team: Team, force = false): Promise<string> {
  const auth = await connection(team);
  if (!auth)
    throw new SacError(
      "Share-A-Cart isn't connected. A mentor can connect it on the Settings page.",
    );
  if (!force && auth.expiresAt > Date.now() + 60_000) return auth.accessToken;
  const c = await getJson<Client>(team, KEY_CLIENT);
  if (!auth.refreshToken || !c) {
    throw new SacError("The Share-A-Cart connection expired. Reconnect it on the Settings page.");
  }
  const t = await token(c, { grant_type: "refresh_token", refresh_token: auth.refreshToken });
  await putJson(team, KEY_AUTH, {
    ...auth,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
  } satisfies SacAuth);
  return t.access_token;
}

type RpcResponse = { id?: number; result?: unknown; error?: { message?: string } };

/** One JSON-RPC message to the MCP server. The reply may be JSON or a server-sent event stream. */
async function rpc(
  tokenValue: string,
  message: Record<string, unknown>,
  session: string | null,
): Promise<{ status: number; session: string | null; reply: RpcResponse | null }> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenValue}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Protocol-Version": PROTOCOL_VERSION,
      ...(session ? { "Mcp-Session-Id": session } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
  });
  const nextSession = res.headers.get("Mcp-Session-Id") ?? session;
  const text = await res.text();
  let reply: RpcResponse | null = null;
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const data = JSON.parse(line.slice(5).trim()) as RpcResponse;
        if (data.id === message.id) reply = data;
      } catch {
        // Not JSON (keep-alive or partial line).
      }
    }
  } else if (text) {
    try {
      reply = JSON.parse(text) as RpcResponse;
    } catch {
      reply = null;
    }
  }
  return { status: res.status, session: nextSession, reply };
}

/** Calls one MCP tool in a fresh session and returns its result. */
async function callTool(
  team: Team,
  name: string,
  args: Record<string, unknown>,
  retried = false,
): Promise<unknown> {
  const t = await accessToken(team, retried);
  const init = await rpc(
    t,
    {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "g3-orders", version: "1.0" },
      },
    },
    null,
  );
  if (init.status === 401 && !retried) return callTool(team, name, args, true);
  if (init.status === 401)
    throw new SacError("Share-A-Cart rejected the team's sign-in. Reconnect it on Settings.");
  if (!init.reply || init.reply.error) {
    throw new SacError(
      `Share-A-Cart didn't start a session (${init.reply?.error?.message ?? `HTTP ${init.status}`}).`,
    );
  }
  await rpc(t, { method: "notifications/initialized" }, init.session);
  const call = await rpc(
    t,
    { id: 2, method: "tools/call", params: { name, arguments: args } },
    init.session,
  );
  if (!call.reply) throw new SacError(`Share-A-Cart didn't answer (HTTP ${call.status}).`);
  if (call.reply.error)
    throw new SacError(`Share-A-Cart: ${call.reply.error.message ?? "request failed"}.`);
  const result = call.reply.result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: { type: string; text?: string }[];
  };
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  if (result.isError) throw new SacError(`Share-A-Cart: ${text || "the cart couldn't be saved"}.`);
  if (result.structuredContent) return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export type SacItem = {
  asin: string;
  name: string;
  img?: string;
  price?: number;
  quantity: number;
  url?: string;
};

/** Creates a shareable cart and returns its link. */
export async function saveCart(
  team: Team,
  cart: {
    vendor: string;
    title: string;
    description?: string;
    items: SacItem[];
    /** The prices' currency (the team's). */
    currency: string;
  },
): Promise<{ cartId: string | null; url: string }> {
  const result = await callTool(team, "sac_save_cart", {
    cart: cart.items,
    vendor: cart.vendor,
    title: cart.title,
    ...(cart.description ? { description: cart.description } : {}),
    ccy: cart.currency,
  });
  const flat = JSON.stringify(result);
  // "A failed save can still return HTTP 200 with an { error } body" (their docs).
  const r = (typeof result === "object" && result !== null ? result : {}) as Record<
    string,
    unknown
  >;
  if (typeof r.error === "string" || r.upstreamOk === false) {
    throw new SacError(
      `Share-A-Cart couldn't save the cart: ${typeof r.error === "string" ? r.error : flat.slice(0, 200)}`,
    );
  }
  const url = flat.match(/https:\/\/(?:www\.)?share-a-cart\.com\/[^\s"'\\)]+/)?.[0];
  const cartId =
    (typeof r.cartid === "string" && r.cartid) ||
    (typeof r.cartId === "string" && r.cartId) ||
    flat.match(/"cart_?id"\s*:\s*"([^"]+)"/i)?.[1] ||
    null;
  if (!url && !cartId)
    throw new SacError(
      `Share-A-Cart saved the cart but didn't return a link: ${flat.slice(0, 200)}`,
    );
  return { cartId, url: url ?? `${SAC}/get/${cartId}` };
}
