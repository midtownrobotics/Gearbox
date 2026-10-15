import { inTeam, teamSettingsRoutes, withTeam } from "@g3/auth";
import { dbOf } from "./db";
import { scoutingEngagementSettings, strategyEventConfig } from "./db/schema";
import { getEngagementSettings } from "./engagement";
import { manifest } from "./manifest";
import type { AppEnv } from "./types";

export const teamSettingsRouter = teamSettingsRoutes<AppEnv>(manifest, "Scouting settings", {
  async read(c) {
    const settings = await getEngagementSettings(c.env.SCOUTING_DB, c.get("teamId"));
    const config = await dbOf(c)
      .select({ tbaKey: strategyEventConfig.tba_auth_key })
      .from(strategyEventConfig)
      .where(inTeam(strategyEventConfig, c.get("teamId")))
      .get();
    return {
      values: { pointsLabel: settings.pointsLabel },
      integrations: {
        "the blue alliance": { connected: Boolean(config?.tbaKey || c.env.TBA_AUTH_KEY) },
      },
    };
  },
  async save(c, changes) {
    const settings = await getEngagementSettings(c.env.SCOUTING_DB, c.get("teamId"));
    const pointsLabel =
      typeof changes.pointsLabel === "string" ? changes.pointsLabel.trim() : settings.pointsLabel;
    if (!pointsLabel || pointsLabel.length > 40) return "Points name must be 1 to 40 characters.";
    const values = {
      enabled: Number(settings.enabled),
      predictions_enabled: Number(settings.predictionsEnabled),
      combinations_enabled: Number(settings.combinationsEnabled),
      leaderboard_enabled: Number(settings.leaderboardEnabled),
      points_label: pointsLabel,
      updated_by: c.get("userId"),
      updated_at: Date.now(),
    };
    await dbOf(c)
      .insert(scoutingEngagementSettings)
      .values(withTeam(c.get("teamId"), values))
      .onConflictDoUpdate({ target: scoutingEngagementSettings.teamId, set: values })
      .run();
  },
});
