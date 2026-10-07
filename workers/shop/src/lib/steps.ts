import { inTeam } from "@g3/auth";
import { type SQL, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { createShopDb } from "../db";
import { partInstanceProcesses } from "../db/schema";

type ShopDb = ReturnType<typeof createShopDb>;

/** The steps just finished, for `promoteNextSteps`' condition. */
export const finished = alias(partInstanceProcesses, "finished");
const next = alias(partInstanceProcesses, "next_step");

/**
 * Makes the step after each finished one (those `where` picks among the team's done steps) ready
 * to start: waiting → todo. The same as the single-instance "done" route, in one statement.
 */
export async function promoteNextSteps(db: ShopDb, teamId: string, where: SQL | undefined) {
  const nextId = db
    .select({ id: next.id })
    .from(next)
    .where(
      inTeam(
        next,
        teamId,
        eq(next.partInstanceId, finished.partInstanceId),
        gt(next.index, finished.index),
      ),
    )
    .orderBy(asc(next.index))
    .limit(1);
  const nextSteps = db
    .select({ id: sql<number>`(${nextId})` })
    .from(finished)
    .where(inTeam(finished, teamId, eq(finished.status, "done"), where));
  await db
    .update(partInstanceProcesses)
    .set({ status: "todo" })
    .where(
      inTeam(
        partInstanceProcesses,
        teamId,
        eq(partInstanceProcesses.status, "waiting"),
        inArray(partInstanceProcesses.id, nextSteps),
      ),
    );
}
