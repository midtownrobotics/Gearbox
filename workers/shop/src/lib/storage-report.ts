// SPDX-License-Identifier: AGPL-3.0-only
import { SHOP_STORAGE_LIMIT, bucketStorageReport, inTeam, teamStorageMode } from "@g3/auth";
import { createShopDb } from "../db";
import { drawings, files } from "../db/schema";
import type { AppEnv } from "../types";
import { teamPrefix } from "./storage";

export async function shopStorageReport(env: AppEnv["Bindings"], teamId: string) {
  const db = createShopDb(env.SHOP_DB);
  const [report, partFiles, pdfs] = await Promise.all([
    teamStorageMode(env, teamId).then((mode) =>
      bucketStorageReport(env.DRAWINGS, teamPrefix(teamId), "Shop files", SHOP_STORAGE_LIMIT, mode),
    ),
    db.select({ key: files.r2Key, name: files.filename }).from(files).where(inTeam(files, teamId)),
    db
      .select({ key: drawings.r2Key, name: drawings.filename })
      .from(drawings)
      .where(inTeam(drawings, teamId)),
  ]);
  const names = new Map([...partFiles, ...pdfs].map((file) => [file.key, file.name]));
  for (const file of report.allowances[0].files) file.name = names.get(file.key) ?? file.name;
  return report;
}
