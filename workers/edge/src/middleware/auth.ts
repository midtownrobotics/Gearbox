import { eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { createEdgeDb } from "../db";
import { edgeStatus, netSettings } from "../db/schema";
import type { AppEnv } from "../types";

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** Constant-time comparison. Digests are compared so length doesn't leak either. */
async function keysMatch(expected: string, provided: string) {
  const [a, b] = await Promise.all([sha256(expected), sha256(provided)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Whether the request carries the agent's key (Authorization: Bearer <key>). */
async function hasAgentKey(c: Context<AppEnv>) {
  const key = c.env.EDGE_AGENT_KEY;
  const header = c.req.header("Authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return Boolean(key && provided && (await keysMatch(key, provided)));
}

/**
 * Records the agent's version, last-seen time, applied state version and
 * public address from its X-G3-Agent-* headers (how the UI knows the box is
 * online and whether changes are pending).
 */
export function recordAgentContact(c: Context<AppEnv>) {
  const version = c.req.header("X-G3-Agent-Version");
  const startedAt = Number(c.req.header("X-G3-Agent-Started"));
  const applied = Number(c.req.header("X-G3-Agent-State-Version") ?? 0);
  if (!version || !Number.isInteger(startedAt)) return;
  const now = Math.floor(Date.now() / 1000);
  // Set by Cloudflare where the request arrived (the gateway passes it on), so
  // it's the hotspot carrier's address, not one the box could choose.
  const publicIp = c.req.header("CF-Connecting-IP")?.slice(0, 64) || null;
  const values = {
    agentVersion: version,
    agentStartedAt: startedAt,
    lastSeenAt: now,
    appliedStateVersion: Number.isInteger(applied) ? applied : 0,
  };
  c.executionCtx.waitUntil(
    createEdgeDb(c.env.EDGE_DB)
      .insert(edgeStatus)
      .values({ id: 1, ...values, publicIp, publicIpSince: publicIp ? now : null })
      .onConflictDoUpdate({
        target: edgeStatus.id,
        set: {
          ...values,
          // Without the header (local dev), keep the last known address.
          publicIp: sql`coalesce(excluded.public_ip, ${edgeStatus.publicIp})`,
          publicIpSince: sql`case
            when excluded.public_ip is null or excluded.public_ip is ${edgeStatus.publicIp}
            then ${edgeStatus.publicIpSince} else excluded.public_ip_since end`,
        },
      })
      .run(),
  );
}

/** Only the agent's key; for the link's upgrade, whose 101 response can't take headers. */
export const requireAgentKey = createMiddleware<AppEnv>(async (c, next) => {
  if (!(await hasAgentKey(c))) return c.json({ error: "Unauthorized." }, 401);
  await next();
});

/**
 * Authenticates the edge agent by its key and records its contact. Returns the
 * desired state version in X-G3-State-Version so the agent re-syncs if it
 * missed a poke.
 */
export const requireAgent = createMiddleware<AppEnv>(async (c, next) => {
  if (!(await hasAgentKey(c))) return c.json({ error: "Unauthorized." }, 401);
  await next();
  const settings = await createEdgeDb(c.env.EDGE_DB)
    .select({ stateVersion: netSettings.stateVersion })
    .from(netSettings)
    .where(eq(netSettings.id, 1))
    .get();
  if (settings) c.res.headers.set("X-G3-State-Version", String(settings.stateVersion));
  recordAgentContact(c);
});
