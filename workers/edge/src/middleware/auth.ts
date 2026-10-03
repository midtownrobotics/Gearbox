import { eq } from "drizzle-orm";
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

/**
 * Authenticates the edge agent by its shared key (Authorization: Bearer <key>).
 * Also records the agent's version, last-seen time, and applied state version
 * (how the UI knows the box is online and whether changes are pending), and
 * returns the desired state version in X-G3-State-Version so the agent
 * re-syncs if it missed a poke.
 */
export const requireAgent = createMiddleware<AppEnv>(async (c, next) => {
  const key = c.env.EDGE_AGENT_KEY;
  const header = c.req.header("Authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!key || !provided || !(await keysMatch(key, provided)))
    return c.json({ error: "Unauthorized." }, 401);

  await next();

  const db = createEdgeDb(c.env.EDGE_DB);
  const settings = await db
    .select({ stateVersion: netSettings.stateVersion })
    .from(netSettings)
    .where(eq(netSettings.id, 1))
    .get();
  if (settings) c.res.headers.set("X-G3-State-Version", String(settings.stateVersion));

  const version = c.req.header("X-G3-Agent-Version");
  const startedAt = Number(c.req.header("X-G3-Agent-Started"));
  const applied = Number(c.req.header("X-G3-Agent-State-Version") ?? 0);
  if (version && Number.isInteger(startedAt)) {
    const values = {
      agentVersion: version,
      agentStartedAt: startedAt,
      lastSeenAt: Math.floor(Date.now() / 1000),
      appliedStateVersion: Number.isInteger(applied) ? applied : 0,
    };
    c.executionCtx.waitUntil(
      db
        .insert(edgeStatus)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: edgeStatus.id, set: values })
        .run(),
    );
  }
});
