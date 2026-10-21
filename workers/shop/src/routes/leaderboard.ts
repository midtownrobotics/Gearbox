import { inTeam, requireAuth } from "@g3/auth";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { actions, partInstances } from "../db/schema";
import { leaderboard } from "../lib/leaderboard";
import type { AppEnv } from "../types";

/** Everyone's steps completed and points (`lib/leaderboard.ts`), in no particular order. */
export const leaderboardRouter = new Hono<AppEnv>().get("/", requireAuth, async (c) => {
  const db = createShopDb(c.env.SHOP_DB);
  const teamId = c.get("teamId");
  const [log, instances] = await Promise.all([
    db
      .select({
        userId: actions.userId,
        partInstanceId: actions.partInstanceId,
        processId: actions.processId,
        action: actions.action,
        createdAt: actions.createdAt,
      })
      .from(actions)
      .where(inTeam(actions, teamId))
      .all(),
    db
      .select({ id: partInstances.id, partDefinitionId: partInstances.partDefinitionId })
      .from(partInstances)
      .where(inTeam(partInstances, teamId))
      .all(),
  ]);
  const partOf = new Map(instances.map((i) => [i.id, i.partDefinitionId]));
  return c.json({ standings: leaderboard(log, partOf) });
});
