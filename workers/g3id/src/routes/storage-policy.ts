// SPDX-License-Identifier: AGPL-3.0-only
import { teamAppUrl } from "@g3/site-config";
import { ne } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { teamStoragePolicy } from "../db/schema";
import { dmAdmins } from "../lib/member-dm";
import { storagePolicy } from "../lib/storage-policy";
import { logToTeam } from "../lib/team-log";
import type { AppEnv } from "../types";

/** Mounted after adminRouter's non-kiosk auth and own-team middleware. */
export const storagePolicyAdminRouter = new Hono<AppEnv>()
  .get("/", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const policy = await storagePolicy(createDb(c.env.DB), c.get("adminTeamId") as string);
    return policy ? c.json(policy) : c.json({ error: "Team not found." }, 404);
  })
  .put("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { automaticDeletion?: unknown } | null;
    if (typeof body?.automaticDeletion !== "boolean")
      return c.json({ error: "Choose what happens when storage is full." }, 400);
    const teamId = c.get("adminTeamId") as string;
    const db = createDb(c.env.DB);
    const before = await storagePolicy(db, teamId);
    if (!before) return c.json({ error: "Team not found." }, 404);
    const automaticDeletion = body.automaticDeletion;
    if (before.automaticDeletion === automaticDeletion) return c.json(before);
    const changed = await db
      .insert(teamStoragePolicy)
      .values({ teamId, automaticDeletion, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: teamStoragePolicy.teamId,
        set: { automaticDeletion, updatedAt: Date.now() },
        setWhere: ne(teamStoragePolicy.automaticDeletion, automaticDeletion),
      })
      .returning({ teamId: teamStoragePolicy.teamId });
    if (changed.length) {
      const text = automaticDeletion
        ? "Automatic file deletion is on. At capacity, files over six months old go first, followed by the oldest remaining files toward 90% usage. Recent files can be permanently removed. Pit logs still follow the choice on Logs."
        : "Automatic file deletion is off. Existing files stay; uploads that would exceed an allowance are blocked, including Pit logs. Download and remove files to make room. Storage warnings at 90%, 95%, and 100% remain on.";
      c.executionCtx.waitUntil(
        Promise.allSettled([
          logToTeam(c.env, teamId, {
            userId: c.get("userId") ?? null,
            app: "id",
            what: "Storage policy",
            changed: ["Automatic file deletion"],
          }),
          dmAdmins(
            c.env,
            teamId,
            `${text} Applies to new uploads; cleanup already in progress may finish. [Storage](${teamAppUrl(teamId, "portal")}/admin/storage)`,
          ),
        ]),
      );
    }
    c.header("Cache-Control", "private, no-store");
    return c.json({ automaticDeletion });
  });
