// SPDX-License-Identifier: AGPL-3.0-only
import {
  SCOUTING_STORAGE_LIMIT,
  type StorageCleanupMode,
  StorageLimitError,
  inTeam,
  notifyStorageCleanup,
  notifyStorageUsage,
  teamStorageMode,
  withStorageLimit,
} from "@g3/auth";
import { eq, inArray } from "drizzle-orm";
import { createDb } from "./db";
import { autoRoutines, fieldMaps, robotImages, scoutingFormSubmissions } from "./db/schema";
import type { AppEnv } from "./types";

export function scoutingStorageEviction(env: AppEnv["Bindings"], teamId: string) {
  return {
    deleteOldest: true,
    policy: () => teamStorageMode(env, teamId),
    usage: (
      usage: { bytes: number; count: number },
      attempted?: boolean,
      mode?: StorageCleanupMode,
      rearm?: boolean,
    ) =>
      notifyStorageUsage(
        env,
        teamId,
        "scouting",
        "files",
        env.SCOUTING_DB,
        usage,
        { bytes: SCOUTING_STORAGE_LIMIT.bytes, count: SCOUTING_STORAGE_LIMIT.objects },
        attempted,
        mode,
        rearm,
      ),
    async removeReferences(objects: R2Object[]) {
      const db = createDb(env.SCOUTING_DB);
      for (let offset = 0; offset < objects.length; offset += 40) {
        const keys = objects.slice(offset, offset + 40).map((file) => file.key);
        const removed = new Set(keys);
        await db.batch([
          db
            .update(autoRoutines)
            .set({ image_r2_key: null, image_content_type: null })
            .where(inTeam(autoRoutines, teamId, inArray(autoRoutines.image_r2_key, keys))),
          db.delete(fieldMaps).where(inTeam(fieldMaps, teamId, inArray(fieldMaps.r2_key, keys))),
          db
            .delete(robotImages)
            .where(inTeam(robotImages, teamId, inArray(robotImages.r2_key, keys))),
        ]);
        // Report IDs are in the object keys, so cleanup doesn't scan every report's JSON.
        const prefix = `teams/${encodeURIComponent(teamId)}/scouting-submissions/`;
        const ids = [
          ...new Set(
            keys
              .filter((key) => key.startsWith(prefix))
              .map((key) =>
                key
                  .slice(prefix.length)
                  .split("/")[0]
                  .replace(/\.(png|json)$/, ""),
              ),
          ),
        ];
        if (!ids.length) continue;
        const reports = await db
          .select({
            id: scoutingFormSubmissions.id,
            drawing: scoutingFormSubmissions.drawing_r2_key,
            fields: scoutingFormSubmissions.drawing_fields_json,
          })
          .from(scoutingFormSubmissions)
          .where(inTeam(scoutingFormSubmissions, teamId, inArray(scoutingFormSubmissions.id, ids)));
        for (const report of reports) {
          const fields = JSON.parse(report.fields) as Record<
            string,
            { key: string; contentType: string }
          >;
          const remaining = Object.fromEntries(
            Object.entries(fields).filter(([, value]) => !removed.has(value.key)),
          );
          await db
            .update(scoutingFormSubmissions)
            .set({
              ...(report.drawing && removed.has(report.drawing)
                ? { drawing_r2_key: null, drawing_content_type: null }
                : {}),
              drawing_fields_json: JSON.stringify(remaining),
            })
            .where(
              inTeam(scoutingFormSubmissions, teamId, eq(scoutingFormSubmissions.id, report.id)),
            );
        }
      }
    },
    notify: (objects: R2Object[]) =>
      notifyStorageCleanup(env, teamId, "scouting", objects, env.SCOUTING_DB),
  };
}

export async function storeScoutingFiles<T = void>(
  env: AppEnv["Bindings"],
  teamId: string,
  files: { key: string; file: File }[],
  commit?: () => Promise<T>,
) {
  if (!files.length) return commit?.();
  if (files.reduce((sum, { file }) => sum + file.size, 0) > 24 * 1024 ** 2) {
    throw new StorageLimitError(
      "Images in one submission must total 24 MB or less.",
      "file_too_large",
      413,
    );
  }
  return withStorageLimit(
    env.SCOUTING_DB,
    env.FIELD_MAPS,
    teamId,
    `teams/${encodeURIComponent(teamId)}/`,
    files.map(({ key, file }) => ({ key, bytes: file.size })),
    SCOUTING_STORAGE_LIMIT,
    async () => {
      try {
        for (const { key, file } of files) {
          await env.FIELD_MAPS.put(key, file.stream(), {
            httpMetadata: { contentType: file.type },
          });
        }
        return await commit?.();
      } catch (error) {
        // These are fresh report/map/auto IDs: failed batches must not leave orphaned images.
        await env.FIELD_MAPS.delete(files.map(({ key }) => key));
        throw error;
      }
    },
    scoutingStorageEviction(env, teamId),
  );
}
