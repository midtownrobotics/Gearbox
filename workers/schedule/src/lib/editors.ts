import { hasMentorAccess, inTeam } from "@g3/auth";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { createDb } from "../db";
import { scheduleEditors } from "../db/schema";
import type { AppEnv } from "../types";

// Sign-in and roles come from @g3/auth; this is Schedule's own rule for who edits schedules.

/**
 * Whether this user may edit schedules: ID's mentors and admins, and the members they trusted
 * in this app (`schedule_editors`). Never a kiosk session.
 */
export async function canEdit(c: Context<AppEnv>): Promise<boolean> {
  if (c.get("sessionType") === "pin") return false;
  if (hasMentorAccess(c)) return true;
  const row = await createDb(c.env.SCHEDULE_DB)
    .select({ userId: scheduleEditors.userId })
    .from(scheduleEditors)
    .where(inTeam(scheduleEditors, c.get("teamId"), eq(scheduleEditors.userId, c.get("userId"))))
    .get();
  return row !== undefined;
}

/** Editors only (403 otherwise). Goes after requireAuth. */
export const requireEditor = createMiddleware<AppEnv>(async (c, next) => {
  if (!(await canEdit(c))) {
    return c.json({ error: "Only mentors and trusted students can change schedules." }, 403);
  }
  await next();
});
