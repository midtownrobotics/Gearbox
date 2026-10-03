import { requireAuth } from "@g3/auth";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createEdgeDb } from "../db";
import { edgeStatus, netSettings } from "../db/schema";
import { probeTunnel } from "../modules/network/control";
import type { AppEnv } from "../types";

/** The agent pushes every 5 minutes; after this long without contact it's shown as offline. */
const OFFLINE_AFTER_SECONDS = 15 * 60;

export const statusRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const [status, settings] = await Promise.all([
      db.select().from(edgeStatus).where(eq(edgeStatus.id, 1)).get(),
      db.select().from(netSettings).where(eq(netSettings.id, 1)).get(),
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
          }
        : null,
      /** Latest settings/blocklist/grant version; the agent is up to date when it matches. */
      stateVersion: settings?.stateVersion ?? 0,
    });
  })
  // Live check of the worker → agent tunnel. Separate from "/" because it can
  // take a few seconds when the box is unreachable.
  .get("/tunnel", requireAuth, async (c) => {
    const result = await probeTunnel(c.env);
    return c.json({ ...result, checkedAt: Math.floor(Date.now() / 1000) });
  });
