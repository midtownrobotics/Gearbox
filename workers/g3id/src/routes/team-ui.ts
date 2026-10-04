import { defaultTeamUiSettings, teamKey } from "@g3/site-config";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { teamUiSettings } from "../db/schema";
import { readTeamUiSettings } from "../lib/team-ui";
import type { AppEnv } from "../types";

export const teamUiRouter = new Hono<AppEnv>().get("/", async (c) => {
  const row = await createDb(c.env.DB)
    .select({ settingsJson: teamUiSettings.settingsJson })
    .from(teamUiSettings)
    .where(eq(teamUiSettings.teamId, teamKey))
    .get();
  c.header("Cache-Control", "public, max-age=60");
  return c.json(row ? readTeamUiSettings(row.settingsJson) : defaultTeamUiSettings);
});
