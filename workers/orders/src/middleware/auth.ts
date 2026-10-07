import { hasMentorAccess, inTeam } from "@g3/auth";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { createOrdersDb } from "../db";
import { appUsers } from "../db/schema";
import type { AppEnv } from "../types";

// Sign-in and roles come from @g3/auth; this is the catalog's own rule.

/** Whether this user may edit the catalog: mentors (and admins), and students mentors trusted. */
export async function canEditCatalog(c: Context<AppEnv>) {
  if (hasMentorAccess(c)) return true;
  const row = await createOrdersDb(c.env.ORDERS_DB)
    .select({ trusted: appUsers.trusted })
    .from(appUsers)
    .where(inTeam(appUsers, c.get("teamId"), eq(appUsers.id, c.get("userId"))))
    .get();
  return row?.trusted === 1;
}

/** Mentors and trusted students: adding categories and adding, editing or deleting parts. Goes after requireAuth. */
export const requireCatalogEditor = createMiddleware<AppEnv>(async (c, next) => {
  if (!(await canEditCatalog(c))) {
    return c.json({ error: "Only mentors and trusted students can change the catalog." }, 403);
  }
  await next();
});
