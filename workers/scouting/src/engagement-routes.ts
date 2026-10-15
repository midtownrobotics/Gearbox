import { hasPermission, logTeamChange, withTeam } from "@g3/auth";
import { Hono } from "hono";
import { dbOf } from "./db";
import { scoutingEngagementSettings } from "./db/schema";
import { getEngagementSettings, parseEngagementSettings } from "./engagement";
import { requireAuth } from "./middleware/auth";
import type { AppEnv } from "./types";

export const engagementRoutes = new Hono<AppEnv>();

engagementRoutes.get("/engagement-settings", requireAuth, async (c) =>
  c.json(await getEngagementSettings(c.env.SCOUTING_DB, c.get("teamId"))),
);

engagementRoutes.put("/engagement-settings", requireAuth, async (c) => {
  if (!hasPermission(c, "manage") || c.get("sessionType") === "pin")
    return c.json({ error: "Only a team trusted student can change engagement settings." }, 403);
  const settings = parseEngagementSettings(await c.req.json().catch(() => null));
  if (!settings)
    return c.json(
      { error: "Use boolean activity switches and a points name of 1 to 40 characters." },
      400,
    );
  const before = await getEngagementSettings(c.env.SCOUTING_DB, c.get("teamId"));
  const values = {
    enabled: Number(settings.enabled),
    predictions_enabled: Number(settings.predictionsEnabled),
    combinations_enabled: Number(settings.combinationsEnabled),
    leaderboard_enabled: Number(settings.leaderboardEnabled),
    points_label: settings.pointsLabel,
    updated_by: c.get("userId"),
    updated_at: Date.now(),
  };
  await dbOf(c)
    .insert(scoutingEngagementSettings)
    .values(withTeam(c.get("teamId"), values))
    .onConflictDoUpdate({ target: scoutingEngagementSettings.teamId, set: values })
    .run();
  // The team's log (its home's Apps page), by the names in Scouting's manifest.
  const names: Record<keyof typeof settings, string> = {
    enabled: "Scout points",
    predictionsEnabled: "Match predictions",
    combinationsEnabled: "Combined picks",
    leaderboardEnabled: "Team standings",
    pointsLabel: "Points name",
  };
  const changed = (Object.keys(names) as (keyof typeof settings)[])
    .filter((key) => before[key] !== settings[key])
    .map((key) => names[key]);
  if (changed.length > 0) {
    await logTeamChange(c.env, c.get("teamId"), {
      userId: c.get("userId"),
      app: "scouting",
      what: "Scouting engagement",
      changed,
    });
  }
  return c.json(settings);
});
