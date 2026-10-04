import { teamKey } from "@g3/site-config";
import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { coreUsers } from "../db/schema";

/**
 * The team this request is for: until the gateway reads the team from the hostname (roadmap step
 * 2.3), the team in site.ts.
 */
export function currentTeamId(): string {
  return teamKey;
}

/** The team a user belongs to. */
export async function teamOfUser(db: Db, userId: string): Promise<string> {
  const user = await db
    .select({ teamId: coreUsers.teamId })
    .from(coreUsers)
    .where(eq(coreUsers.id, userId))
    .get();
  if (!user) throw new Error(`No user ${userId}.`);
  return user.teamId;
}
