// SPDX-License-Identifier: AGPL-3.0-only
import { and, count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { coreUsers, subteams } from "../db/schema";
import { newId } from "../lib/id";
import {
  SUBTEAMS_MAX,
  SUBTEAM_NAME_MAX,
  chosenSubteam,
  cleanSubteamName,
  findSubteam,
  listSubteams,
  saveSubteamsEnabled,
  subteamBody,
  subteamsEnabled,
  teamSubteams,
} from "../lib/subteams";
import { teamOfUser } from "../lib/team";
import { logToTeam } from "../lib/team-log";
import { requireAdmin, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

// Subteams (lib/subteams.ts). Members read the team's and choose their own on their Account
// page; the team's admins switch them on and name them on the Subteams page of the team's admin
// pages (through /api/~id). An admin sets a member's on their page (PUT /admin/users/:id/subteam).

type Db = ReturnType<typeof createDb>;

const NAME_ERROR = `Enter a name of up to ${SUBTEAM_NAME_MAX} characters.`;

/** Whether another of the team's subteams already has this name (ignoring case). */
async function nameTaken(db: Db, teamId: string, name: string, except?: string) {
  const rows = await db
    .select({ id: subteams.id })
    .from(subteams)
    .where(and(eq(subteams.teamId, teamId), sql`${subteams.name} = ${name} COLLATE NOCASE`))
    .all();
  return rows.some((r) => r.id !== except);
}

/** The admin page's view: on or off, and each subteam with how many members it has. */
async function adminView(db: Db, teamId: string) {
  const [enabled, list, counts] = await Promise.all([
    subteamsEnabled(db, teamId),
    listSubteams(db, teamId),
    db
      .select({ subteamId: coreUsers.subteamId, members: count() })
      .from(coreUsers)
      .where(and(eq(coreUsers.teamId, teamId), eq(coreUsers.status, "active")))
      .groupBy(coreUsers.subteamId)
      .all(),
  ]);
  const byId = new Map(counts.map((r) => [r.subteamId, r.members]));
  return {
    enabled,
    subteams: list.map((s) => ({ ...s, members: byId.get(s.id) ?? 0 })),
  };
}

export const subteamsRouter = new Hono<AppEnv>()
  .use("*", requireAuth)
  // The team's subteams and the member's own, for their Account page.
  .get("/", async (c) => {
    const db = createDb(c.env.DB);
    const userId = c.get("userId") as string;
    const [team, me] = await Promise.all([
      teamOfUser(db, userId),
      db
        .select({ subteamId: coreUsers.subteamId })
        .from(coreUsers)
        .where(eq(coreUsers.id, userId))
        .get(),
    ]);
    return c.json({ ...(await teamSubteams(db, team)), mine: me?.subteamId ?? null });
  })
  // The member chooses their own subteam, or none.
  .put("/mine", subteamBody, async (c) => {
    const body = c.req.valid("json");
    const db = createDb(c.env.DB);
    const userId = c.get("userId") as string;
    const team = await teamOfUser(db, userId);
    const subteam = await chosenSubteam(db, team, body.subteamId);
    if (subteam === "invalid") return c.json({ error: "Choose one of your team's subteams." }, 400);
    await db
      .update(coreUsers)
      .set({ subteamId: subteam?.id ?? null, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(coreUsers.id, userId));
    return c.json({ mine: subteam?.id ?? null });
  });

export const adminSubteamsRouter = new Hono<AppEnv>()
  .use("*", requireAdmin)
  .get("/", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await adminView(db, await teamOfUser(db, c.get("userId") as string)));
  })
  // Subteams on or off.
  .put("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== "boolean") return c.json({ error: "Say on or off." }, 400);
    const db = createDb(c.env.DB);
    const userId = c.get("userId") as string;
    const team = await teamOfUser(db, userId);
    const before = await subteamsEnabled(db, team);
    await saveSubteamsEnabled(db, team, body.enabled, userId);
    if (before !== body.enabled) {
      await logToTeam(c.env, team, {
        userId,
        app: "id",
        what: "Subteams",
        changed: [body.enabled ? "Subteams on" : "Subteams off"],
      });
    }
    return c.json(await adminView(db, team));
  })
  .post("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
    const name = cleanSubteamName(body?.name);
    if (!name) return c.json({ error: NAME_ERROR }, 400);
    const db = createDb(c.env.DB);
    const userId = c.get("userId") as string;
    const team = await teamOfUser(db, userId);
    if ((await listSubteams(db, team)).length >= SUBTEAMS_MAX) {
      return c.json({ error: `A team can have up to ${SUBTEAMS_MAX} subteams.` }, 400);
    }
    if (await nameTaken(db, team, name)) {
      return c.json({ error: `There's already a subteam called ${name}.` }, 409);
    }
    const now = Math.floor(Date.now() / 1000);
    await db
      .insert(subteams)
      .values({ id: newId(), teamId: team, name, createdAt: now, updatedAt: now });
    await logToTeam(c.env, team, { userId, app: "id", what: "Subteams", changed: ["Added one"] });
    return c.json(await adminView(db, team), 201);
  })
  .put("/:id", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
    const name = cleanSubteamName(body?.name);
    if (!name) return c.json({ error: NAME_ERROR }, 400);
    const db = createDb(c.env.DB);
    const userId = c.get("userId") as string;
    const team = await teamOfUser(db, userId);
    const id = c.req.param("id");
    if (!(await findSubteam(db, team, id))) return c.json({ error: "Subteam not found." }, 404);
    if (await nameTaken(db, team, name, id)) {
      return c.json({ error: `There's already a subteam called ${name}.` }, 409);
    }
    await db
      .update(subteams)
      .set({ name, updatedAt: Math.floor(Date.now() / 1000) })
      .where(and(eq(subteams.teamId, team), eq(subteams.id, id)));
    await logToTeam(c.env, team, { userId, app: "id", what: "Subteams", changed: ["Renamed one"] });
    return c.json(await adminView(db, team));
  })
  // Deleting a subteam leaves its members in none.
  .delete("/:id", async (c) => {
    const db = createDb(c.env.DB);
    const userId = c.get("userId") as string;
    const team = await teamOfUser(db, userId);
    const id = c.req.param("id");
    if (!(await findSubteam(db, team, id))) return c.json({ error: "Subteam not found." }, 404);
    await db.batch([
      db
        .update(coreUsers)
        .set({ subteamId: null })
        .where(and(eq(coreUsers.teamId, team), eq(coreUsers.subteamId, id))),
      db.delete(subteams).where(and(eq(subteams.teamId, team), eq(subteams.id, id))),
    ]);
    await logToTeam(c.env, team, { userId, app: "id", what: "Subteams", changed: ["Deleted one"] });
    return c.json(await adminView(db, team));
  });
