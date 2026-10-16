import { inTeam, teamSettingsRoutes, withTeam } from "@g3/auth";
import { type WriteQuery, batch, dbOf } from "./db";
import { scoutingEngagementSettings, strategyEventConfig } from "./db/schema";
import { getEngagementSettings } from "./engagement";
import { manifest } from "./manifest";
import { DEFAULT_AUTO_ADVANCE_DELAY_MINUTES, parseAutoAdvanceDelay } from "./match-advance";
import type { AppEnv } from "./types";

export const teamSettingsRouter = teamSettingsRoutes<AppEnv>(manifest, "Scouting settings", {
  async read(c) {
    const settings = await getEngagementSettings(c.env.SCOUTING_DB, c.get("teamId"));
    const config = await dbOf(c)
      .select({
        tbaKey: strategyEventConfig.tba_auth_key,
        autoAdvanceDelayMinutes: strategyEventConfig.auto_advance_delay_minutes,
      })
      .from(strategyEventConfig)
      .where(inTeam(strategyEventConfig, c.get("teamId")))
      .get();
    return {
      values: {
        pointsLabel: settings.pointsLabel,
        autoAdvanceDelayMinutes:
          config?.autoAdvanceDelayMinutes ?? DEFAULT_AUTO_ADVANCE_DELAY_MINUTES,
      },
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
    const delay =
      changes.autoAdvanceDelayMinutes === undefined
        ? undefined
        : parseAutoAdvanceDelay(changes.autoAdvanceDelayMinutes);
    if (delay === null) return "Auto-advance delay must be a whole number from 0 to 30 minutes.";
    const values = {
      enabled: Number(settings.enabled),
      predictions_enabled: Number(settings.predictionsEnabled),
      combinations_enabled: Number(settings.combinationsEnabled),
      leaderboard_enabled: Number(settings.leaderboardEnabled),
      points_label: pointsLabel,
      updated_by: c.get("userId"),
      updated_at: Date.now(),
    };
    const writes: WriteQuery[] = [
      dbOf(c)
        .insert(scoutingEngagementSettings)
        .values(withTeam(c.get("teamId"), values))
        .onConflictDoUpdate({ target: scoutingEngagementSettings.teamId, set: values }),
    ];
    if (delay !== undefined) {
      const delayValues = {
        auto_advance_delay_minutes: delay,
        updated_by: c.get("userId"),
        updated_at: Date.now(),
      };
      writes.push(
        dbOf(c)
          .insert(strategyEventConfig)
          .values(withTeam(c.get("teamId"), { id: 1, ...delayValues }))
          .onConflictDoUpdate({
            target: [strategyEventConfig.teamId, strategyEventConfig.id],
            set: delayValues,
          }),
      );
    }
    await batch(dbOf(c), writes);
  },
});
