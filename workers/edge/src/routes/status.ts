import { inTeam, requireAuth } from "@g3/auth";
import { Hono } from "hono";
import { createEdgeDb } from "../db";
import { edgeStatus } from "../db/schema";
import { AGENT_TOO_OLD, AgentError, agentFetch } from "../lib/agent";
import { teamBox } from "../lib/box-key";
import { getSettings } from "../modules/network/common";
import { probeLink } from "../modules/network/control";
import type { InterfacesResponse } from "../modules/network/interface-types";
import type { AppEnv } from "../types";

/** The agent pushes every 5 minutes; after this long without contact it's shown as offline. */
export const OFFLINE_AFTER_SECONDS = 15 * 60;

export const statusRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const teamId = c.get("teamId");
    const [status, settings, box] = await Promise.all([
      db.select().from(edgeStatus).where(inTeam(edgeStatus, teamId)).get(),
      getSettings(db, teamId),
      teamBox(db, teamId),
    ]);
    const now = Math.floor(Date.now() / 1000);
    return c.json({
      now,
      agent: status
        ? {
            version: status.agentVersion,
            startedAt: status.agentStartedAt,
            lastSeenAt: status.lastSeenAt,
            online: now - status.lastSeenAt < OFFLINE_AFTER_SECONDS,
            appliedStateVersion: status.appliedStateVersion,
            publicIp: status.publicIp,
            publicIpSince: status.publicIpSince,
            timeZone: status.timeZone,
          }
        : null,
      /** Whether the team has made a key for its box yet (Edge Box page). */
      hasBox: box !== undefined,
      /** Latest settings/blocklist/grant version; the agent is up to date when it matches. */
      stateVersion: settings.stateVersion,
    });
  })
  // Live check of the box's link. Separate from "/" because it can take a few
  // seconds when the box is connected but not answering.
  .get("/connection", requireAuth, async (c) => {
    const result = await probeLink(c.env, c.get("teamId"));
    return c.json({ ...result, checkedAt: Math.floor(Date.now() / 1000) });
  })
  // The box's LAN and WAN addresses, asked live over its link.
  .get("/interfaces", requireAuth, async (c) => {
    try {
      const res = await agentFetch(c.env, c.get("teamId"), "/network/interfaces", {
        timeoutMs: 8_000,
      });
      if (res.status === 404) {
        return c.json({ error: AGENT_TOO_OLD }, 502);
      }
      if (!res.ok) return c.json({ error: `The edge box returned HTTP ${res.status}.` }, 502);
      return c.json((await res.json()) as InterfacesResponse);
    } catch (err) {
      if (err instanceof AgentError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });
