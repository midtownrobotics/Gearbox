// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { clearStorageCleanupNotice } from "./storage-notice";
import type { StorageCleanupMode } from "./storage-policy";

// Ephemeral coordination only; each adopting app adds the matching migration.
const locks = sqliteTable("storage_upload_locks", {
  teamId: text("team_id").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

// An estimate of each team's stored files that is never below what's really there: every write
// adds its full size, deletes take nothing off, and only a full count under the lock corrects it.
const usage = sqliteTable("storage_usage", {
  teamId: text("team_id").primaryKey(),
  bytes: integer("bytes").notNull(),
  objects: integer("objects").notNull(),
});

/** Lifecycle cleanup for an interrupted upload's expired coordination row. */
export async function clearTeamStorageLock(database: D1Database, teamId: string) {
  await drizzle(database).delete(locks).where(eq(locks.teamId, teamId));
  await drizzle(database).delete(usage).where(eq(usage.teamId, teamId));
  await clearStorageCleanupNotice(database, teamId);
}

async function adjustUsage(database: D1Database, teamId: string, bytes: number, objects: number) {
  await drizzle(database)
    .insert(usage)
    .values({ teamId, bytes, objects })
    .onConflictDoUpdate({
      target: usage.teamId,
      set: { bytes: sql`${usage.bytes} + ${bytes}`, objects: sql`${usage.objects} + ${objects}` },
    });
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
  // Waits up to 10 s, so a few saves arriving together at the end of a match each get their turn.
  const giveUpAt = Date.now() + 10_000;
  let acquired: { owner: string } | undefined;
  for (let delay = 50; ; delay = Math.min(delay * 2, 500)) {
    const now = Date.now();
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
    if (acquired || Date.now() + delay > giveUpAt) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
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

/** Unknown dates sort last; deterministic key/id ties are supplied by the caller. */
export function storageCleanupTime(uploaded: Date | number): number {
  const time = uploaded instanceof Date ? uploaded.getTime() : uploaded;
  return Number.isFinite(time) && time > 0 ? time : Number.POSITIVE_INFINITY;
}

export type StorageEviction = {
  /** Oldest first at capacity, including recent files when older files cannot reach the target. */
  deleteOldest?: boolean;
  /** Rechecked inside the quota lock before a counted save; unavailable disables automatic cleanup. */
  policy?: () => Promise<StorageCleanupMode>;
  /** Exact reviewed versions; without deleteOldest, other files remain protected. */
  approvedObjects?: ReadonlyMap<string, string>;
  /** Remove database references before the matching files are removed. */
  removeReferences: (objects: R2Object[]) => Promise<void>;
  usage?: (
    usage: { bytes: number; count: number },
    attempted?: boolean,
    mode?: StorageCleanupMode,
    rearm?: boolean,
  ) => Promise<void>;
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
  const incomingBytes = incoming.reduce((sum, file) => sum + file.bytes, 0);
  // Well below the cap (the cleanup target), a save only adds itself to the estimate: no lock and
  // no count, so saves arriving together don't wait for each other.
  const reserved = await drizzle(database)
    .update(usage)
    .set({
      bytes: sql`${usage.bytes} + ${incomingBytes}`,
      objects: sql`${usage.objects} + ${incoming.length}`,
    })
    .where(
      and(
        eq(usage.teamId, teamId),
        sql`${usage.bytes} + ${incomingBytes} < ${Math.floor(limit.bytes * STORAGE_CLEANUP_RATIO)}`,
        sql`${usage.objects} + ${incoming.length} < ${Math.floor(limit.objects * STORAGE_CLEANUP_RATIO)}`,
      ),
    )
    .returning({ bytes: usage.bytes, objects: usage.objects })
    .get();
  if (reserved) {
    const result = await write();
    // This upper bound can safely rearm warnings below 85%; never send warnings from an estimate.
    if (
      (!(result instanceof Response) || result.ok) &&
      reserved.bytes / limit.bytes < 0.85 &&
      reserved.objects / limit.objects < 0.85
    ) {
      try {
        await eviction?.usage?.({ bytes: reserved.bytes, count: reserved.objects });
      } catch (error) {
        console.error("[storage] usage notice failed", error);
      }
    }
    return result;
  }

  return withTeamStorageLock(database, teamId, async () => {
    // Saves that took the fast path meanwhile stay on top of the count made here.
    const before = await drizzle(database)
      .select({ bytes: usage.bytes, objects: usage.objects })
      .from(usage)
      .where(eq(usage.teamId, teamId))
      .get();
    const mode: StorageCleanupMode = eviction?.policy
      ? await eviction.policy()
      : eviction?.deleteOldest
        ? "delete-oldest"
        : "block-uploads";
    const cleanupEnabled = Boolean(eviction?.approvedObjects?.size || mode === "delete-oldest");
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
          mode === "delete-oldest" ||
          (eviction?.approvedObjects?.has(object.key) &&
            eviction.approvedObjects.get(object.key) === object.etag)
        ) {
          candidates.push(object);
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    await adjustUsage(
      database,
      teamId,
      originalBytes - (before?.bytes ?? 0),
      originalObjects - (before?.objects ?? 0),
    );
    bytes += incomingBytes;
    objects += incoming.length;
    const projected = { bytes, count: objects };
    const reportUsage = async (attempted = false) => {
      try {
        await eviction?.usage?.(projected, attempted, mode);
      } catch (error) {
        console.error("[storage] usage notice failed", error);
      }
    };
    const rearmAfterSave = async () => {
      if (Math.max(originalBytes / limit.bytes, originalObjects / limit.objects) >= 0.85) return;
      try {
        await eviction?.usage?.({ bytes: originalBytes, count: originalObjects }, false, mode);
      } catch (error) {
        console.error("[storage] usage notice failed", error);
      }
    };
    if (bytes > limit.bytes || objects > limit.objects) {
      if (
        eviction &&
        cleanupEnabled &&
        incoming.reduce((sum, file) => sum + file.bytes, 0) <= limit.bytes &&
        incoming.length <= limit.objects
      ) {
        candidates.sort(
          (a, b) =>
            storageCleanupTime(a.uploaded) - storageCleanupTime(b.uploaded) ||
            a.key.localeCompare(b.key),
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
            await adjustUsage(
              database,
              teamId,
              -removed.reduce((sum, file) => sum + file.size, 0),
              -removed.length,
            );
            try {
              await eviction.notify?.(removed);
            } catch (error) {
              console.error("[storage] cleanup notice failed", error);
            }
          };
          // Recover a previous incomplete cleanup before allowing any more growth.
          if (originalBytes > limit.bytes || originalObjects > limit.objects) {
            await reportUsage(true);
            await cleanup();
            await adjustUsage(database, teamId, incomingBytes, incoming.length);
            return write();
          }
          await adjustUsage(database, teamId, incomingBytes, incoming.length);
          // A failed new save must not destroy old files to make room for nothing.
          const result = await write();
          if (!(result instanceof Response) || result.ok) {
            await rearmAfterSave();
            await reportUsage();
            await cleanup();
          }
          return result;
        }
      }
      await reportUsage(true);
      throw new StorageLimitError(
        `Your team's file storage is full (${limit.label} or ${limit.objects.toLocaleString("en-US")} files). ${mode === "unavailable" ? "Cleanup settings could not be checked; existing files were kept." : !cleanupEnabled ? "Automatic deletion is off; existing files were kept." : "This upload cannot fit."} Download and remove files to make room.`,
        "storage_full",
      );
    }
    await adjustUsage(database, teamId, incomingBytes, incoming.length);
    const result = await write();
    if (!(result instanceof Response) || result.ok) {
      await rearmAfterSave();
      await reportUsage();
    }
    return result;
  });
}
