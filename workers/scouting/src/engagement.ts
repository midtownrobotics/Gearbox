import { inTeam } from "@g3/auth";
import { createDb } from "./db";
import { scoutingEngagementSettings } from "./db/schema";
export type EngagementSettings = {
  enabled: boolean;
  predictionsEnabled: boolean;
  combinationsEnabled: boolean;
  leaderboardEnabled: boolean;
  pointsLabel: string;
};

export const defaultEngagementSettings: EngagementSettings = {
  enabled: false,
  predictionsEnabled: true,
  combinationsEnabled: false,
  leaderboardEnabled: false,
  pointsLabel: "Scout Points",
};

// Callers supply the authenticated team; scheduled work supplies its explicit team.
export async function getEngagementSettings(
  db: D1Database,
  teamId: string,
): Promise<EngagementSettings> {
  const row = await createDb(db)
    .select()
    .from(scoutingEngagementSettings)
    .where(inTeam(scoutingEngagementSettings, teamId))
    .get();
  return row
    ? {
        enabled: Boolean(row.enabled),
        predictionsEnabled: Boolean(row.predictions_enabled),
        combinationsEnabled: Boolean(row.combinations_enabled),
        leaderboardEnabled: Boolean(row.leaderboard_enabled),
        pointsLabel: row.points_label,
      }
    : { ...defaultEngagementSettings };
}

export function parseEngagementSettings(value: unknown): EngagementSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  for (const key of [
    "enabled",
    "predictionsEnabled",
    "combinationsEnabled",
    "leaderboardEnabled",
  ]) {
    if (typeof input[key] !== "boolean") return null;
  }
  if (typeof input.pointsLabel !== "string") return null;
  const pointsLabel = input.pointsLabel.trim();
  if (
    !pointsLabel ||
    pointsLabel.length > 40 ||
    Array.from(pointsLabel).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  return {
    enabled: input.enabled as boolean,
    predictionsEnabled: input.predictionsEnabled as boolean,
    combinationsEnabled: input.combinationsEnabled as boolean,
    leaderboardEnabled: input.leaderboardEnabled as boolean,
    pointsLabel,
  };
}
