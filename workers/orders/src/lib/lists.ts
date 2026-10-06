import { eq, inArray } from "drizzle-orm";
import type { OrdersDb } from "../db";
import { orderRequests, partListItems, partLists } from "../db/schema";
import { inChunks } from "./chunks";

/**
 * Puts requests on a list (ones already there are left alone). Returns how many were new, or
 * null if any request doesn't exist.
 */
export async function addToList(
  db: OrdersDb,
  listId: number,
  requestIds: number[],
  addedByName: string,
): Promise<number | null> {
  const existing = await inChunks(requestIds, (chunk) =>
    db
      .select({ id: orderRequests.id })
      .from(orderRequests)
      .where(inArray(orderRequests.id, chunk))
      .all(),
  );
  if (existing.length !== requestIds.length) return null;
  const now = Date.now();
  // Four values a row: chunks of 20 rows stay under D1's limit.
  const inserted = await inChunks(
    requestIds,
    (chunk) =>
      db
        .insert(partListItems)
        .values(chunk.map((requestId) => ({ listId, requestId, addedByName, addedAt: now })))
        .onConflictDoNothing()
        .returning()
        .all(),
    20,
  );
  await db.update(partLists).set({ updatedAt: now }).where(eq(partLists.id, listId));
  return inserted.length;
}
