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

/** One of the team's settings, or "" when it hasn't set it. */
export async function getSetting(db: Db, team: string, key: SettingKey): Promise<string> {
  const [row] = await db
    .select()
    .from(settings)
    .where(inTeam(settings, team, eq(settings.key, key)));
  return row?.value ?? "";
}

/** The team's FRC number, from its id ("frc1648" → "1648"). */
export const teamNumberOf = (team: string) => team.replace(/^frc/, "");
