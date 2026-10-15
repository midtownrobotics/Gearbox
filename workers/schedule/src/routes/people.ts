import { activeMembers, inTeam, requireAuth, requireMentor, withTeam } from "@g3/auth";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { scheduleEditors } from "../db/schema";
import { requireEditor } from "../lib/editors";
import { nowSeconds } from "../lib/input";
import type { AppEnv } from "../types";

// The team's members, for choosing who attends an event (editors), and the trusted students who
// may edit schedules besides mentors and admins (mentors and admins choose them, on Schedule's
// Admin page). Schedule keeps no list of people: names and roles come from G3ID.

const membersUnavailable = { error: "Couldn't load the team's members. Try again." } as const;

export const membersRouter = new Hono<AppEnv>().get("/", requireAuth, requireEditor, async (c) => {
  const members = await activeMembers(c.env, c.get("teamId"));
  if (!members) return c.json(membersUnavailable, 503);
  return c.json(
    members
      .map(({ id, displayName, isMentor, isAdmin }) => ({ id, displayName, isMentor, isAdmin }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
});

export const editorsRouter = new Hono<AppEnv>()
  .use("*", requireMentor)
  .get("/", async (c) => {
    const team = c.get("teamId");
    const [rows, members] = await Promise.all([
      createDb(c.env.SCHEDULE_DB)
        .select()
        .from(scheduleEditors)
        .where(inTeam(scheduleEditors, team))
        .orderBy(asc(scheduleEditors.addedAt))
        .all(),
      activeMembers(c.env, team),
    ]);
    const names = new Map(members?.map((m) => [m.id, m.displayName]) ?? []);
    return c.json(
      rows.map((row) => ({
        userId: row.userId,
        displayName: names.get(row.userId) ?? null,
        /** False for someone who has since left the team: they can't edit anymore anyway. */
        active: names.has(row.userId),
        addedAt: row.addedAt,
      })),
    );
  })
  .put("/:userId", async (c) => {
    const team = c.get("teamId");
    const userId = c.req.param("userId");
    const members = await activeMembers(c.env, team);
    if (!members) return c.json(membersUnavailable, 503);
    if (!members.some((m) => m.id === userId)) {
      return c.json({ error: "Only the team's active members can edit schedules." }, 400);
    }
    await createDb(c.env.SCHEDULE_DB)
      .insert(scheduleEditors)
      .values(withTeam(team, { userId, addedBy: c.get("userId"), addedAt: nowSeconds() }))
      .onConflictDoNothing();
    return c.json({ ok: true });
  })
  .delete("/:userId", async (c) => {
    const team = c.get("teamId");
    await createDb(c.env.SCHEDULE_DB)
      .delete(scheduleEditors)
      .where(inTeam(scheduleEditors, team, eq(scheduleEditors.userId, c.req.param("userId"))));
    return c.json({ ok: true });
  });
