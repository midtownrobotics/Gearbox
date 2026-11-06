// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { clearStorageCleanupNotice } from "./storage-notice";

// Ephemeral coordination only; each adopting app adds the matching migration.
const locks = sqliteTable("storage_upload_locks", {
  teamId: text("team_id").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

/** Lifecycle cleanup for an interrupted upload's expired coordination row. */
export async function clearTeamStorageLock(database: D1Database, teamId: string) {
  await drizzle(database).delete(locks).where(eq(locks.teamId, teamId));
  await clearStorageCleanupNotice(database, teamId);
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
export const STORAGE_CLEANUP_RATIO = 0.9;

/** Six calendar months in UTC, clamping month-end dates rather than rolling into March. */
export function storageRetentionCutoff(now = Date.now()): number {
  const cutoff = new Date(now);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  const lastDay = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
  ).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDay));
  return cutoff.getTime();
}

export function isStorageFileExpired(uploaded: Date | number, now = Date.now()): boolean {
  const time = uploaded instanceof Date ? uploaded.getTime() : uploaded;
  return Number.isFinite(time) && time > 0 && time < storageRetentionCutoff(now);
}

export type StorageEviction = {
  /** Automatically eligible only when strictly older than six calendar months. */
  deleteOlderThanSixMonths?: boolean;
  /** Exact file versions explicitly reviewed for deletion. Missing approval protects all files. */
  approvedObjects?: ReadonlyMap<string, string>;
  /** Remove database references before the matching files are removed. */
  removeReferences: (objects: R2Object[]) => Promise<void>;
  /** Best-effort admin notice after a successful cleanup. */
  notify?: (objects: R2Object[]) => Promise<void>;
};

/** Includes existing and orphaned objects; replacement files spend only their size difference. */
export async function withStorageLimit<T>(
  database: D1Database,
  bucket: R2Bucket,
  teamId: string,
  prefix: string,
  incoming: { key: string; bytes: number }[],
  limit: { bytes: number; objects: number; label: string },
  write: () => Promise<T>,
  eviction?: StorageEviction,
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
    const cleanupEnabled = Boolean(
      eviction?.approvedObjects?.size || eviction?.deleteOlderThanSixMonths,
    );
    const now = Date.now();
    let bytes = 0;
    let objects = 0;
    let originalBytes = 0;
    let originalObjects = 0;
    let cursor: string | undefined;
    const candidates: R2Object[] = [];
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
        } else if (
          (eviction?.deleteOlderThanSixMonths && isStorageFileExpired(object.uploaded, now)) ||
          (eviction?.approvedObjects?.has(object.key) &&
            eviction.approvedObjects.get(object.key) === object.etag)
        ) {
          candidates.push(object);
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    bytes += incoming.reduce((sum, file) => sum + file.bytes, 0);
    objects += incoming.length;
    if (
      (bytes > limit.bytes && (cleanupEnabled || bytes > originalBytes)) ||
      (objects > limit.objects && (cleanupEnabled || objects > originalObjects))
    ) {
      if (
        eviction &&
        cleanupEnabled &&
        incoming.reduce((sum, file) => sum + file.bytes, 0) <= limit.bytes &&
        incoming.length <= limit.objects
      ) {
        candidates.sort(
          (a, b) => a.uploaded.getTime() - b.uploaded.getTime() || a.key.localeCompare(b.key),
        );
        const removed: R2Object[] = [];
        // Count the incoming save in the target, and never evict the incoming files themselves.
        const targetBytes = Math.max(
          Math.floor(limit.bytes * STORAGE_CLEANUP_RATIO),
          incoming.reduce((sum, file) => sum + file.bytes, 0),
        );
        const targetObjects = Math.max(
          Math.floor(limit.objects * STORAGE_CLEANUP_RATIO),
          incoming.length,
        );
        for (const object of candidates) {
          if (bytes <= targetBytes && objects <= targetObjects) break;
          removed.push(object);
          bytes -= object.size;
          objects--;
        }
        if (bytes <= limit.bytes && objects <= limit.objects) {
          const cleanup = async () => {
            await eviction.removeReferences(removed);
            for (let offset = 0; offset < removed.length; offset += 1000) {
              await bucket.delete(removed.slice(offset, offset + 1000).map((file) => file.key));
            }
            try {
              await eviction.notify?.(removed);
            } catch (error) {
              console.error("[storage] cleanup notice failed", error);
            }
          };
          // Recover a previous incomplete cleanup before allowing any more growth.
          if (originalBytes > limit.bytes || originalObjects > limit.objects) {
            await cleanup();
            return write();
          }
          // A failed new save must not destroy old files to make room for nothing.
          const result = await write();
          if (!(result instanceof Response) || result.ok) await cleanup();
          return result;
        }
      }
      throw new StorageLimitError(
        `Your team's file storage is full (${limit.label} or ${limit.objects.toLocaleString("en-US")} files). Files from the last six months are protected. Review files before choosing what to remove.`,
        "storage_full",
      );
    }
    return write();
  });
}
