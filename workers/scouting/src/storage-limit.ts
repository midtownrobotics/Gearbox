// SPDX-License-Identifier: AGPL-3.0-only
import { SCOUTING_STORAGE_LIMIT, StorageLimitError, withStorageLimit } from "@g3/auth";
import type { AppEnv } from "./types";

export async function storeScoutingFiles(
  env: AppEnv["Bindings"],
  teamId: string,
  files: { key: string; file: File }[],
) {
  if (!files.length) return;
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
      } catch (error) {
        // These are fresh report/map/auto IDs: failed batches must not leave orphaned images.
        await env.FIELD_MAPS.delete(files.map(({ key }) => key));
        throw error;
      }
    },
  );
}
