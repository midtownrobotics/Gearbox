// SPDX-License-Identifier: AGPL-3.0-only
import { SCOUTING_STORAGE_LIMIT, bucketStorageReport, inTeam, teamStorageMode } from "@g3/auth";
import { inArray } from "drizzle-orm";
import { createDb } from "./db";
import { autoRoutines, fieldMaps, robotImages, scoutingFormSubmissions } from "./db/schema";
import type { AppEnv } from "./types";

export async function scoutingStorageReport(env: AppEnv["Bindings"], teamId: string) {
  const db = createDb(env.SCOUTING_DB);
  const prefix = `teams/${encodeURIComponent(teamId)}/`;
  const [report, autos, maps, photos] = await Promise.all([
    teamStorageMode(env, teamId).then((mode) =>
      bucketStorageReport(env.FIELD_MAPS, prefix, "Scouting files", SCOUTING_STORAGE_LIMIT, mode),
    ),
    db
      .select({ key: autoRoutines.image_r2_key, name: autoRoutines.name })
      .from(autoRoutines)
      .where(inTeam(autoRoutines, teamId)),
    db
      .select({ key: fieldMaps.r2_key, name: fieldMaps.name })
      .from(fieldMaps)
      .where(inTeam(fieldMaps, teamId)),
    db
      .select({ key: robotImages.r2_key, name: robotImages.robot_id })
      .from(robotImages)
      .where(inTeam(robotImages, teamId)),
  ]);
  const names = new Map([
    ...autos.map((row) => [row.key, `Auton: ${row.name}`] as const),
    ...maps.map((row) => [row.key, `Field map: ${row.name}`] as const),
    ...photos.map((row) => [row.key, `Robot photo: ${row.name}`] as const),
  ]);
  const files = report.allowances[0].files;
  const reportPrefix = `${prefix}scouting-submissions/`;
  const reportId = (key: string) =>
    key
      .slice(reportPrefix.length)
      .split("/")[0]
      .replace(/\.(png|json)$/, "");
  const ids = [
    ...new Set(
      files.filter((file) => file.key.startsWith(reportPrefix)).map((file) => reportId(file.key)),
    ),
  ];
  const reports = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += 40) {
    const rows = await db
      .select({
        id: scoutingFormSubmissions.id,
        team: scoutingFormSubmissions.team_name,
        match: scoutingFormSubmissions.match_key,
        event: scoutingFormSubmissions.event_key,
      })
      .from(scoutingFormSubmissions)
      .where(
        inTeam(
          scoutingFormSubmissions,
          teamId,
          inArray(scoutingFormSubmissions.id, ids.slice(offset, offset + 40)),
        ),
      );
    for (const row of rows)
      reports.set(
        row.id,
        ["Report", row.team, row.match ?? row.event, row.id].filter(Boolean).join(" · "),
      );
  }
  for (const file of files) {
    const label =
      names.get(file.key) ??
      (file.key.startsWith(reportPrefix) ? reports.get(reportId(file.key)) : null);
    if (label) file.name = `${label} — ${file.name}`;
  }
  return report;
}
