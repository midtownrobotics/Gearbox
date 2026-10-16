import { inTeam, teamSettingsRoutes, withTeam } from "@g3/auth";
import { teamApiKey } from "./api-keys";
import { type WriteQuery, batch, dbOf } from "./db";
import { scoutingEngagementSettings, strategyEventConfig } from "./db/schema";
import { getEngagementSettings } from "./engagement";
import { manifest } from "./manifest";
import { DEFAULT_SUBMISSION_WINDOW, submissionWindow } from "./match-advance";
import type { AppEnv } from "./types";

export const teamSettingsRouter = teamSettingsRoutes<AppEnv>(manifest, "Scouting settings", {
  async read(c) {
    const settings = await getEngagementSettings(c.env.SCOUTING_DB, c.get("teamId"));
    const config = await dbOf(c)
      .select({
        tbaKey: strategyEventConfig.tba_auth_key,
        submissionWindowSeconds: strategyEventConfig.submission_window_seconds,
      })
      .from(strategyEventConfig)
      .where(inTeam(strategyEventConfig, c.get("teamId")))
      .get();
    return {
      values: {
        pointsLabel: settings.pointsLabel,
        submissionWindowSeconds: config?.submissionWindowSeconds ?? DEFAULT_SUBMISSION_WINDOW,
      },
      integrations: {
        "the blue alliance": {
          connected: Boolean(teamApiKey(c.get("teamId"), config?.tbaKey, c.env.TBA_AUTH_KEY)),
        },
      },
    };
  },
  async save(c, changes) {
    const settings = await getEngagementSettings(c.env.SCOUTING_DB, c.get("teamId"));
    const pointsLabel =
      typeof changes.pointsLabel === "string" ? changes.pointsLabel.trim() : settings.pointsLabel;
    if (!pointsLabel || pointsLabel.length > 40) return "Points name must be 1 to 40 characters.";
    const delay =
      changes.submissionWindowSeconds === undefined
        ? undefined
        : submissionWindow(changes.submissionWindowSeconds);
    if (delay === null) return "Scouting window must be a whole number from 0 to 1800 seconds.";
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
        submission_window_seconds: delay,
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
