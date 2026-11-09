// SPDX-License-Identifier: AGPL-3.0-only
import {
  MAX_SHOP_FILE_BYTES,
  SHOP_STORAGE_LIMIT,
  StorageLimitError,
  inTeam,
  notifyStorageCleanup,
  notifyStorageUsage,
  withStorageLimit,
} from "@g3/auth";
import { inArray } from "drizzle-orm";
import { createShopDb } from "../db";
import { drawings, files, stagingBatches } from "../db/schema";
import type { AppEnv } from "../types";
import { teamPrefix } from "./storage";

export function shopStorageEviction(env: AppEnv["Bindings"], teamId: string) {
  return {
    deleteOldest: true,
    usage: (usage: { bytes: number; count: number }, attempted?: boolean) =>
      notifyStorageUsage(
        env,
        teamId,
        "shop",
        "files",
        env.SHOP_DB,
        usage,
        { bytes: SHOP_STORAGE_LIMIT.bytes, count: SHOP_STORAGE_LIMIT.objects },
        attempted,
      ),
    async removeReferences(objects: R2Object[]) {
      const db = createShopDb(env.SHOP_DB);
      for (let offset = 0; offset < objects.length; offset += 40) {
        const keys = objects.slice(offset, offset + 40).map((file) => file.key);
        const rows = await db
          .select({ id: files.id })
          .from(files)
          .where(inTeam(files, teamId, inArray(files.r2Key, keys)));
        const ids = rows.map((row) => row.id);
        await db.batch([
          db
            .update(stagingBatches)
            .set({ fileId: null })
            .where(inTeam(stagingBatches, teamId, inArray(stagingBatches.fileId, ids))),
          db.delete(files).where(inTeam(files, teamId, inArray(files.r2Key, keys))),
          db.delete(drawings).where(inTeam(drawings, teamId, inArray(drawings.r2Key, keys))),
        ]);
      }
    },
    notify: (objects: R2Object[]) =>
      notifyStorageCleanup(env, teamId, "shop", objects, env.SHOP_DB),
  };
}

export async function withShopFile<T>(
  env: AppEnv["Bindings"],
  teamId: string,
  key: string,
  body: File | ArrayBuffer | Uint8Array,
  contentType: string,
  save: (store: () => Promise<R2Object | null>) => Promise<T>,
) {
  const bytes = body instanceof File ? body.size : body.byteLength;
  if (bytes > MAX_SHOP_FILE_BYTES) {
    throw new StorageLimitError("Files must be 100 MB or smaller.", "file_too_large", 413);
  }
  return withStorageLimit(
    env.SHOP_DB,
    env.DRAWINGS,
    teamId,
    teamPrefix(teamId),
    [{ key, bytes }],
    SHOP_STORAGE_LIMIT,
    () =>
      save(() =>
        env.DRAWINGS.put(key, body instanceof File ? body.stream() : body, {
          httpMetadata: { contentType },
        }),
      ),
    shopStorageEviction(env, teamId),
  );
}

export function putShopFile(
  env: AppEnv["Bindings"],
  teamId: string,
  key: string,
  body: File | ArrayBuffer | Uint8Array,
  contentType: string,
) {
  return withShopFile(env, teamId, key, body, contentType, (store) => store());
}
