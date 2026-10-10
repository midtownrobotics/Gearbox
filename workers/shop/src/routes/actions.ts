import { inTeam, requireAuth, withTeam } from "@g3/auth";
import { desc } from "drizzle-orm";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { actions } from "../db/schema";
import type { AppEnv } from "../types";

export const actionsRouter = new Hono<AppEnv>().get("/", requireAuth, async (c) => {
  const db = createShopDb(c.env.SHOP_DB);
  const rows = await db
    .select()
    .from(actions)
    .where(inTeam(actions, c.get("teamId")))
    .orderBy(desc(actions.createdAt))
    .all();
  return c.json(rows);
});

/** Record a part-process action in the audit log. Never throws — logging must
 * not block the underlying status change. */
export async function recordAction(
  db: ReturnType<typeof createShopDb>,
  teamId: string,
  entry: {
    userId: string;
    partInstanceId: number;
    processId: number;
    action: "started" | "completed";
  },
): Promise<void> {
  try {
    await db.insert(actions).values(withTeam(teamId, { ...entry, createdAt: Date.now() }));
  } catch (err) {
    console.error("Failed to record action:", err);
  }
}
