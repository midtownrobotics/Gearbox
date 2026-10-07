import { inTeam, requestTeamId, withTeam } from "@g3/auth";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { createEdgeDb } from "../db";
import { edgeStatus } from "../db/schema";
import { isTeamBoxKey } from "../lib/box-key";
import { getSettings } from "../modules/network/common";
import type { AppEnv } from "../types";

// The box signs in with its team's key (lib/box-key.ts), on its team's own address: the gateway
// says which team (X-Team-Id), and the key must be that team's. The team is then `c.get("teamId")`
// like on a member's request.

/** Whether the request carries the team's box key (Authorization: Bearer <key>). */
async function hasBoxKey(c: Context<AppEnv>, teamId: string) {
  const header = c.req.header("Authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return isTeamBoxKey(createEdgeDb(c.env.EDGE_DB), teamId, provided);
}

/**
 * Records the agent's version, last-seen time, applied state version, time zone and public
 * address from its X-G3-Agent-* headers (how the UI knows the box is online and whether changes
 * are pending, and which days to count in).
 */
export function recordAgentContact(c: Context<AppEnv>) {
  const teamId = c.get("teamId");
  const version = c.req.header("X-G3-Agent-Version");
  const startedAt = Number(c.req.header("X-G3-Agent-Started"));
  const applied = Number(c.req.header("X-G3-Agent-State-Version") ?? 0);
  if (!version || !Number.isInteger(startedAt)) return;
  const now = Math.floor(Date.now() / 1000);
  // Set by Cloudflare where the request arrived (the gateway passes it on), so
  // it's the hotspot carrier's address, not one the box could choose.
  const publicIp = c.req.header("CF-Connecting-IP")?.slice(0, 64) || null;
  // Older agents don't say; the last one known stays.
  const zone = c.req.header("X-G3-Agent-Time-Zone")?.slice(0, 64) || null;
  const values = {
    agentVersion: version,
    agentStartedAt: startedAt,
    lastSeenAt: now,
    appliedStateVersion: Number.isInteger(applied) ? applied : 0,
  };
  c.executionCtx.waitUntil(
    createEdgeDb(c.env.EDGE_DB)
      .insert(edgeStatus)
      .values(
        withTeam(teamId, {
          ...values,
          publicIp,
          publicIpSince: publicIp ? now : null,
          timeZone: zone,
        }),
      )
      .onConflictDoUpdate({
        target: edgeStatus.teamId,
        set: {
          ...values,
          // Without the header (local dev), keep the last known address.
          publicIp: sql`coalesce(excluded.public_ip, ${edgeStatus.publicIp})`,
          publicIpSince: sql`case
            when excluded.public_ip is null or excluded.public_ip is ${edgeStatus.publicIp}
            then ${edgeStatus.publicIpSince} else excluded.public_ip_since end`,
          timeZone: sql`coalesce(excluded.time_zone, ${edgeStatus.timeZone})`,
        },
        setWhere: inTeam(edgeStatus, teamId),
      })
      .run(),
  );
}

/** Only the box's key; for the link's upgrade, whose 101 response can't take headers. */
export const requireAgentKey = createMiddleware<AppEnv>(async (c, next) => {
  const teamId = requestTeamId(c);
  if (!(await hasBoxKey(c, teamId))) return c.json({ error: "Unauthorized." }, 401);
  c.set("teamId", teamId);
  await next();
});

/**
 * Authenticates the team's box by its key and records its contact. Returns the
 * desired state version in X-G3-State-Version so the agent re-syncs if it
 * missed a poke.
 */
export const requireAgent = createMiddleware<AppEnv>(async (c, next) => {
  const teamId = requestTeamId(c);
  if (!(await hasBoxKey(c, teamId))) return c.json({ error: "Unauthorized." }, 401);
  c.set("teamId", teamId);
  await next();
  const settings = await getSettings(createEdgeDb(c.env.EDGE_DB), teamId);
  c.res.headers.set("X-G3-State-Version", String(settings.stateVersion));
  recordAgentContact(c);
});
