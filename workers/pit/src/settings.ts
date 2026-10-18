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

/**
 * What Pit does with a new match log once the team has MAX_LOGS (match-logs.ts): `skip-new`
 * leaves it on the downloader (the default), `delete-oldest` deletes the oldest log to make room.
 * Mentors and admins choose on the Logs page.
 */
export const WHEN_FULL = ["skip-new", "delete-oldest"] as const;
export type WhenFull = (typeof WHEN_FULL)[number];

export async function getWhenFull(db: Db, team: string): Promise<WhenFull> {
  const value = await getSetting(db, team, "matchLogsWhenFull");
  return (WHEN_FULL as readonly string[]).includes(value) ? (value as WhenFull) : "skip-new";
}

/**
 * Settings Pit keeps for itself, never edited on the Admin page: the battery timers' state
 * (battery-timers.ts).
 */
export type InternalSettingKey =
  | "batteryTimersPaused"
  | "batteryTimersAppliedAt"
  | "batteryTimersEvents";

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
