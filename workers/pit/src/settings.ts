// SPDX-License-Identifier: AGPL-3.0-only
import { inTeam } from "@g3/auth";
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { settings } from "./db/schema";

/**
 * A team's settings. The Blue Alliance and Nexus API keys aren't among them: every team's monitor
 * uses the worker's own (TBA_AUTH_KEY, NEXUS_API_KEY).
 */
export const SETTING_KEYS = ["eventKey", "nexusEventKey", "iframeUrl"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** At capacity only logs older than six calendar months are automatically eligible. */
export const WHEN_FULL = ["delete-expired"] as const;
export type WhenFull = (typeof WHEN_FULL)[number];

export async function getWhenFull(_db: Db, _team: string): Promise<WhenFull> {
  return "delete-expired";
}

/**
 * Settings Pit keeps for itself, not among the team's settings: the battery timers' state
 * (battery-timers.ts) and, in dev and staging, the event snapshot (event-snapshot.ts).
 */
export type InternalSettingKey =
  | "batteryTimersPaused"
  | "batteryTimersAppliedAt"
  | "batteryTimersEvents"
  | "eventSnapshotSince";

/** One of the team's settings, or "" when it hasn't set it. */
export async function getSetting(
  db: Db,
  team: string,
  key: SettingKey | "matchLogsWhenFull" | InternalSettingKey,
): Promise<string> {
  const [row] = await db
    .select()
    .from(settings)
    .where(inTeam(settings, team, eq(settings.key, key)));
  return row?.value ?? "";
}

/** The team's FRC number, from its id ("frc1648" → "1648"). */
export const teamNumberOf = (team: string) => team.replace(/^frc/, "");
