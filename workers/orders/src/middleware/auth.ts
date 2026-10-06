import { hasMentorAccess } from "@g3/auth";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

// Sign-in and roles come from @g3/auth; this is the catalog's own rule.

/** Whether this user may edit the catalog: mentors (and admins), and students mentors trusted. */
export async function canEditCatalog(c: Context<AppEnv>) {
  if (hasMentorAccess(c)) return true;
  const row = await c.env.ORDERS_DB.prepare("SELECT trusted FROM app_users WHERE id = ?")
    .bind(c.get("userId"))
    .first<{ trusted: number }>();
  return row?.trusted === 1;
}

/** Mentors and trusted students: adding categories and adding, editing or deleting parts. Goes after requireAuth. */
export const requireCatalogEditor = createMiddleware<AppEnv>(async (c, next) => {
  if (!(await canEditCatalog(c))) {
    return c.json({ error: "Only mentors and trusted students can change the catalog." }, 403);
  }
  await next();
});
