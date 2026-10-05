import { defaultTeamUiSettings } from "@g3/site-config";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { teamUiSettings } from "../db/schema";
import { requestTeamId } from "../lib/team";
import { readTeamUiSettings } from "../lib/team-ui";
import type { AppEnv } from "../types";

// The appearance of the team a page is for (the gateway's X-Team-Id; the site's team without it).
export const teamUiRouter = new Hono<AppEnv>().get("/", async (c) => {
  const row = await createDb(c.env.DB)
    .select({ settingsJson: teamUiSettings.settingsJson })
    .from(teamUiSettings)
    .where(eq(teamUiSettings.teamId, requestTeamId(c)))
    .get();
  c.header("Cache-Control", "public, max-age=60");
  return c.json(row ? readTeamUiSettings(row.settingsJson) : defaultTeamUiSettings);
});
