import { inTeam, logTeamChange, requireAdmin, requireAuth, withTeam } from "@g3/auth";
import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createShopDb } from "../db";
import { projects } from "../db/schema";
import { projectUsage, removeProject } from "../lib/removal";
import type { AppEnv } from "../types";

// The team's projects (a robot, a practice bot): each Onshape document and each subsystem belongs
// to one, so every part has one. Every project, removed ones too (`archivedAt`), so what already
// uses one still shows its name. Only admins add, rename, remove and restore them.

/** A project's name: required, at most 80 characters. */
const nameValidator = validator("json", (value, c): { name: string } => {
  const v = (value ?? {}) as { name?: unknown };
  const name = typeof v.name === "string" ? v.name.trim().slice(0, 80) : "";
  if (!name) return c.json({ error: "name is required." }, 400) as never;
  return { name };
});

export const projectsRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const rows = await db
      .select()
      .from(projects)
      .where(inTeam(projects, c.get("teamId")))
      .orderBy(projects.createdAt, projects.id)
      .all();
    return c.json(rows);
  })
  /** How many parts each project has, for the Admin page to say what removing one does. */
  .get("/usage", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    return c.json(Object.fromEntries(await projectUsage(db, c.get("teamId"))));
  })
  .post("/", requireAdmin, nameValidator, async (c) => {
    const { name } = c.req.valid("json");

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const taken = await db
      .select({ id: projects.id })
      .from(projects)
      .where(inTeam(projects, teamId, eq(projects.name, name)))
      .get();
    if (taken) return c.json({ error: `There's already a project called ${name}.` }, 409);

    const row = await db
      .insert(projects)
      .values(withTeam(teamId, { name, createdAt: Date.now() }))
      .returning()
      .get();
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "shop",
      what: `Added project ${name}`,
    });
    return c.json(row, 201);
  })
  .patch("/:id", requireAdmin, nameValidator, async (c) => {
    const { name } = c.req.valid("json");

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const id = Number(c.req.param("id"));
    const taken = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(inTeam(projects, teamId, eq(projects.name, name)), ne(projects.id, id)))
      .get();
    if (taken) return c.json({ error: `There's already a project called ${name}.` }, 409);

    const before = await db
      .select({ name: projects.name })
      .from(projects)
      .where(inTeam(projects, teamId, eq(projects.id, id)))
      .get();
    if (!before) return c.json({ error: "Project not found." }, 404);
    const row = await db
      .update(projects)
      .set({ name })
      .where(inTeam(projects, teamId, eq(projects.id, id)))
      .returning()
      .get();
    if (before.name !== name) {
      await logTeamChange(c.env, teamId, {
        userId: c.get("userId"),
        app: "shop",
        what: `Renamed project ${before.name} to ${name}`,
      });
    }
    return c.json(row);
  })
  /** Deletes the project, or archives it while subsystems, documents or releases use it. */
  .delete("/:id", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const removed = await removeProject(db, teamId, Number(c.req.param("id")));
    if ("error" in removed) return c.json({ error: removed.error }, removed.status);
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "shop",
      what: `Removed project ${removed.name}`,
    });
    return c.json(removed);
  })
  .post("/:id/restore", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const row = await db
      .update(projects)
      .set({ archivedAt: null })
      .where(inTeam(projects, teamId, eq(projects.id, Number(c.req.param("id")))))
      .returning()
      .get();
    if (!row) return c.json({ error: "Project not found." }, 404);
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "shop",
      what: `Restored project ${row.name}`,
    });
    return c.json(row);
  });
