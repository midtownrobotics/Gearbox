import { inTeam, logTeamChange, requireAdmin, requireAuth, withTeam } from "@g3/auth";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { subsystems } from "../db/schema";
import { removeSubsystem, subsystemUsage } from "../lib/removal";
import type { AppEnv } from "../types";

// Every subsystem, removed ones too (`archivedAt`): what already uses one still shows its name,
// and pickers for new parts leave them out. Only admins add, remove and restore them.
export const subsystemsRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const rows = await db
      .select()
      .from(subsystems)
      .where(inTeam(subsystems, c.get("teamId")))
      .all();
    return c.json(rows);
  })
  /** How many parts use each subsystem, for the Admin page to say what removing one does. */
  .get("/usage", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const usage = await subsystemUsage(db, c.get("teamId"));
    return c.json(Object.fromEntries(usage));
  })
  .post("/", requireAdmin, async (c) => {
    const body = await c.req.json<{ name?: unknown }>().catch(() => ({ name: undefined }));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "name is required." }, 400);

    const db = createShopDb(c.env.SHOP_DB);
    const row = await db
      .insert(subsystems)
      .values(withTeam(c.get("teamId"), { name, createdAt: Date.now() }))
      .returning()
      .get();

    return c.json(row, 201);
  })
  /** Deletes the subsystem, or archives it while parts use it. */
  .delete("/:id", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const removed = await removeSubsystem(db, teamId, Number(c.req.param("id")));
    if ("error" in removed) return c.json({ error: removed.error }, removed.status);
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "shop",
      what: `Removed subsystem ${removed.name}`,
    });
    return c.json(removed);
  })
  .post("/:id/restore", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const row = await db
      .update(subsystems)
      .set({ archivedAt: null })
      .where(inTeam(subsystems, teamId, eq(subsystems.id, Number(c.req.param("id")))))
      .returning()
      .get();
    if (!row) return c.json({ error: "Subsystem not found." }, 404);
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "shop",
      what: `Restored subsystem ${row.name}`,
    });
    return c.json(row);
  });
