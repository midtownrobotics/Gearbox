import { logTeamChange, requireAdmin, withTeam } from "@g3/auth";
import { Hono } from "hono";
import { createEdgeDb } from "../db";
import { edgeBoxes } from "../db/schema";
import { disconnectBox } from "../lib/agent";
import { writeAudit } from "../lib/audit";
import { hashKey, newKey, teamBox } from "../lib/box-key";
import type { AppEnv } from "../types";

/**
 * The team's box and its key (G3ID admins, never from a kiosk). Making a key replaces the old one
 * and disconnects the box until it's given the new key; the key is shown only in this answer.
 */
export const boxRouter = new Hono<AppEnv>()
  .get("/", requireAdmin, async (c) => {
    const box = await teamBox(createEdgeDb(c.env.EDGE_DB), c.get("teamId"));
    return c.json({ box: box ?? null });
  })
  .post("/key", requireAdmin, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const teamId = c.get("teamId");
    const key = newKey();
    const values = {
      keyHash: await hashKey(key),
      keyHint: key.slice(-4),
      createdBy: c.get("userId"),
      createdByName: c.get("userDisplayName"),
      createdAt: Math.floor(Date.now() / 1000),
    };
    await db.batch([
      db
        .insert(edgeBoxes)
        .values(withTeam(teamId, values))
        .onConflictDoUpdate({ target: edgeBoxes.teamId, set: values }),
      writeAudit(
        db,
        teamId,
        { id: c.get("userId"), displayName: c.get("userDisplayName") },
        "box.key.create",
        { keyHint: values.keyHint },
      ),
    ]);
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "edge",
      what: "New box key (the old one stopped working)",
      changed: ["Box key"],
    });
    // A box still on the old key is cut off now, not at its next reconnect.
    c.executionCtx.waitUntil(disconnectBox(c.env, teamId).catch(() => undefined));
    return c.json({ key, keyHint: values.keyHint }, 201);
  });
