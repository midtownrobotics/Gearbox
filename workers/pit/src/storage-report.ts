// SPDX-License-Identifier: AGPL-3.0-only
import {
  type StorageReport,
  inTeam,
  listStorageObjects,
  storageFile,
  storageRetentionCutoff,
  teamStorageMode,
} from "@g3/auth";
import { eq } from "drizzle-orm";
import { MAX_ASSETS, MAX_ASSET_BYTES, scopePrefix } from "./advantagescope";
import { createDb } from "./db";
import { matchLogs, scopeAssets } from "./db/schema";
import { MAX_LOGS, logsPrefix } from "./match-logs";
import { getWhenFull } from "./settings";
import type { AppEnv } from "./types";

export async function pitStorageReport(
  env: AppEnv["Bindings"],
  teamId: string,
): Promise<StorageReport> {
  const checkedAt = Date.now();
  const db = createDb(env.PIT_DB);
  const [logs, assets, objects, whenFull, mode] = await Promise.all([
    db
      .select()
      .from(matchLogs)
      .where(inTeam(matchLogs, teamId, eq(matchLogs.status, "stored"))),
    db.select().from(scopeAssets).where(inTeam(scopeAssets, teamId)),
    listStorageObjects(env.LOGS, scopePrefix(teamId)),
    getWhenFull(db, teamId),
    teamStorageMode(env, teamId),
  ]);
  const files = objects.map((object) => ({
    ...storageFile(object, scopePrefix(teamId), checkedAt),
    eligible: mode === "delete-oldest",
  }));
  const byKey = new Map(files.map((file) => [file.key, file]));
  const referenced = new Set<string>();
  for (const asset of assets) {
    const members = (JSON.parse(asset.files) as { name: string; size: number }[]).map((file) => {
      const key = `${scopePrefix(teamId)}${asset.name}/${file.name}`;
      referenced.add(key);
      return { file: byKey.get(key), size: file.size };
    });
    const times = [
      asset.uploadedAt,
      ...members.filter(({ file }) => file).map(({ file }) => file?.uploadedAt ?? 0),
    ];
    const groupTime = times.every((time) => Number.isFinite(time) && time > 0)
      ? Math.max(...times)
      : null;
    for (const { file, size } of members)
      if (file) {
        file.eligible = mode === "delete-oldest";
        file.bytes = size;
        file.uploadedAt = groupTime;
        file.eligibleAfter = null;
      }
  }
  return {
    checkedAt,
    cutoff: storageRetentionCutoff(checkedAt),
    cleanupMode: mode,
    allowances: [
      {
        id: "logs",
        name: "Pit match logs",
        bytes: logs.reduce((n, log) => n + log.size, 0),
        byteLimit: null,
        count: logs.length,
        countLimit: MAX_LOGS,
        countLabel: "logs",
        cleanupEnabled: mode === "delete-oldest" && whenFull === "delete-oldest",
        cleanupConfigured: whenFull === "delete-oldest",
        files: logs.map((log) => ({
          key: log.r2Key,
          name: log.r2Key.slice(logsPrefix(teamId).length),
          bytes: log.size,
          uploadedAt:
            (log.uploadedAt ?? log.createdAt) > 0 ? (log.uploadedAt ?? log.createdAt) : null,
          eligibleAfter: null,
          eligible: mode === "delete-oldest" && whenFull === "delete-oldest",
        })),
      },
      {
        id: "assets",
        name: "Pit AdvantageScope assets",
        bytes:
          assets.reduce((n, a) => n + a.size, 0) +
          files.filter((f) => !referenced.has(f.key)).reduce((n, f) => n + f.bytes, 0),
        byteLimit: MAX_ASSET_BYTES,
        count: assets.length,
        countLimit: MAX_ASSETS,
        countLabel: "assets",
        cleanupEnabled: mode === "delete-oldest",
        files,
      },
    ],
  };
}
