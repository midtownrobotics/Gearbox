import { Hono } from "hono";
import { createDb } from "../db";
import { requestTeamId } from "../lib/team";
import { loadTeamUi } from "../lib/team-ui";
import type { AppEnv } from "../types";

// The appearance of the team a page is for (the gateway's X-Team-Id; the site's team without it).
export const teamUiRouter = new Hono<AppEnv>().get("/", async (c) => {
  const { settings } = await loadTeamUi(createDb(c.env.DB), requestTeamId(c));
  c.header("Cache-Control", "public, max-age=60");
  return c.json(settings);
});
