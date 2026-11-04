// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Ephemeral coordination only; each adopting app adds the matching migration.
const locks = sqliteTable("storage_upload_locks", {
  teamId: text("team_id").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

/** Lifecycle cleanup for an interrupted upload's expired coordination row. */
export async function clearTeamStorageLock(database: D1Database, teamId: string) {
  await drizzle(database).delete(locks).where(eq(locks.teamId, teamId));
}

export class StorageLimitError extends Error {
  constructor(
    message: string,
    readonly code: "storage_full" | "upload_busy" | "file_too_large",
    readonly status: 409 | 413 = 409,
  ) {
    super(message);
  }
}

export function storageLimitResponse(error: unknown): Response | null {
  if (!(error instanceof StorageLimitError)) return null;
  return Response.json(
    { error: error.message, code: error.code },
    {
      status: error.status,
      headers: {
        "Cache-Control": "no-store",
        ...(error.code === "upload_busy" ? { "Retry-After": "2" } : {}),
      },
    },
  );
}

/** Serialize quota checks and writes across isolates; no check-then-upload race. */
export async function withTeamStorageLock<T>(
  database: D1Database,
  teamId: string,
  write: () => Promise<T>,
): Promise<T> {
  const db = drizzle(database);
  const owner = crypto.randomUUID();
  const now = Date.now();
  let acquired: { owner: string } | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    acquired = await db
      .insert(locks)
      .values({ teamId, owner, expiresAt: now + 10 * 60_000 })
      .onConflictDoUpdate({
        target: locks.teamId,
        set: { owner, expiresAt: now + 10 * 60_000 },
        setWhere: lt(locks.expiresAt, now),
      })
      .returning({ owner: locks.owner })
      .get();
    if (acquired) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!acquired) {
    throw new StorageLimitError(
      "Another upload is saving. Wait a moment and try again.",
      "upload_busy",
    );
  }
  try {
    return await write();
  } finally {
    await db.delete(locks).where(and(eq(locks.teamId, teamId), eq(locks.owner, owner)));
  }
}

export const SHOP_STORAGE_LIMIT = { bytes: 5 * 1024 ** 3, objects: 10_000, label: "5 GB" };
export const SCOUTING_STORAGE_LIMIT = { bytes: 2 * 1024 ** 3, objects: 25_000, label: "2 GB" };
export const MAX_SHOP_FILE_BYTES = 100 * 1024 ** 2;

/** Includes existing and orphaned objects; replacement files spend only their size difference. */
export async function withStorageLimit<T>(
  database: D1Database,
  bucket: R2Bucket,
  teamId: string,
  prefix: string,
  incoming: { key: string; bytes: number }[],
  limit: { bytes: number; objects: number; label: string },
  write: () => Promise<T>,
): Promise<T> {
  if (
    new Set(incoming.map((file) => file.key)).size !== incoming.length ||
    incoming.some(
      (file) => !file.key.startsWith(prefix) || !Number.isSafeInteger(file.bytes) || file.bytes < 0,
    )
  ) {
    throw new Error("Invalid storage reservation.");
  }
  return withTeamStorageLock(database, teamId, async () => {
    let bytes = 0;
    let objects = 0;
    let originalBytes = 0;
    let originalObjects = 0;
    let cursor: string | undefined;
    const replaced = new Map(incoming.map((file) => [file.key, file.bytes]));
    do {
      const page = await bucket.list({ prefix, cursor, limit: 1000 });
      for (const object of page.objects) {
        originalBytes += object.size;
        originalObjects++;
        bytes += object.size;
        objects++;
        if (replaced.has(object.key)) {
          bytes -= object.size;
          objects--;
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    bytes += incoming.reduce((sum, file) => sum + file.bytes, 0);
    objects += incoming.length;
    if (
      (bytes > limit.bytes && bytes > originalBytes) ||
      (objects > limit.objects && objects > originalObjects)
    ) {
      throw new StorageLimitError(
        `Your team's file storage is full (${limit.label} or ${limit.objects.toLocaleString("en-US")} files). Remove unneeded files and try again. Existing files are still available.`,
        "storage_full",
      );
    }
    return write();
  });
}
