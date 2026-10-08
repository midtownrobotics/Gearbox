import { inTeam, withTeam } from "@g3/auth";
import { eq, inArray, ne } from "drizzle-orm";
import type { OrdersDb } from "../db";
import { orderRequests, partListItems, partLists } from "../db/schema";
import { inChunks } from "./chunks";

/**
 * Puts the team's requests on one of its lists (ones already there are left alone). Returns how
 * many were new, or null if any request isn't the team's.
 */
export async function addToList(
  db: OrdersDb,
  teamId: string,
  listId: number,
  requestIds: number[],
  addedByName: string,
): Promise<number | null> {
  const existing = await inChunks(requestIds, (chunk) =>
    db
      .select({ id: orderRequests.id })
      .from(orderRequests)
      // Lists are of requests: wishlist items can't go on one until they're promoted.
      .where(
        inTeam(
          orderRequests,
          teamId,
          inArray(orderRequests.id, chunk),
          ne(orderRequests.status, "wishlist"),
        ),
      )
      .all(),
  );
  if (existing.length !== requestIds.length) return null;
  const now = Date.now();
  // Five values a row: chunks of 20 rows stay under D1's limit.
  const inserted = await inChunks(
    requestIds,
    (chunk) =>
      db
        .insert(partListItems)
        .values(
          withTeam(
            teamId,
            chunk.map((requestId) => ({ listId, requestId, addedByName, addedAt: now })),
          ),
        )
        .onConflictDoNothing()
        .returning()
        .all(),
    20,
  );
  await db
    .update(partLists)
    .set({ updatedAt: now })
    .where(inTeam(partLists, teamId, eq(partLists.id, listId)));
  return inserted.length;
}
