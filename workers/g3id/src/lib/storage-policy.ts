// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm";
import type { createDb } from "../db";
import { teamStoragePolicy, teams } from "../db/schema";

export async function storagePolicy(db: ReturnType<typeof createDb>, teamId: string) {
  const row = await db
    .select({ automaticDeletion: teamStoragePolicy.automaticDeletion })
    .from(teams)
    .leftJoin(teamStoragePolicy, eq(teamStoragePolicy.teamId, teams.id))
    .where(eq(teams.id, teamId))
    .get();
  return row ? { automaticDeletion: row.automaticDeletion ?? true } : null;
}
