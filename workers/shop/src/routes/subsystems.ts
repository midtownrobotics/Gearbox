import { inTeam, logTeamChange, requireAdmin, requireAuth, withTeam } from "@g3/auth";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { projects, subsystems } from "../db/schema";
import { removeSubsystem, removedError, subsystemUsage } from "../lib/removal";
import type { AppEnv } from "../types";

// Every subsystem, removed ones too (`archivedAt`): what already uses one still shows its name,
// and pickers for new parts leave them out. Each is in one project (`projectId`), which is its
// parts' project. Only admins add, remove and restore them.
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
  /** A new subsystem, in one of the team's projects that hasn't been removed. */
  .post("/", requireAdmin, async (c) => {
    const body = await c.req
      .json<{ name?: unknown; projectId?: unknown }>()
      .catch(() => ({ name: undefined, projectId: undefined }));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "name is required." }, 400);
    const projectId = Number(body.projectId);
    if (!Number.isInteger(projectId) || projectId < 1) {
      return c.json({ error: "Choose the project it's for." }, 400);
    }

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const project = await db
      .select({ name: projects.name, archivedAt: projects.archivedAt })
      .from(projects)
      .where(inTeam(projects, teamId, eq(projects.id, projectId)))
      .get();
    if (!project) return c.json({ error: "That project doesn't exist." }, 400);
    if (project.archivedAt !== null) {
      return c.json({ error: removedError("project", [project]) }, 400);
    }
    const row = await db
      .insert(subsystems)
      .values(withTeam(teamId, { name, projectId, createdAt: Date.now() }))
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
