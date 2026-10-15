import { isPermissionApp } from "@g3/auth";
import { SlackApiError, listChannels } from "@g3/slack";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { createDb } from "../db";
import { coreUsers } from "../db/schema";
import { assignedPermissions } from "../lib/permissions";
import { isPinSession } from "../lib/session";
import { slackForTeam } from "../lib/slack-install";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

/** Read-only channel choices for the app whose settings the admin is editing. */
export const appChannelsRouter = new Hono<AppEnv>()
  .use("*", requireAuth)
  .use("*", async (c, next) => {
    const app = c.req.query("app") ?? "id";
    if (!isPermissionApp(app) || !["id", "shop", "portal"].includes(app))
      return c.json({ error: "Choose an app with Slack settings." }, 400);
    const db = createDb(c.env.DB);
    const user = await db
      .select()
      .from(coreUsers)
      .where(eq(coreUsers.id, c.get("userId") as string))
      .get();
    if (
      !user ||
      user.status !== "active" ||
      (await isPinSession(getCookie(c, "g3_session"), c.env))
    )
      return c.json({ error: "Admin access required." }, 403);
    if (c.req.header("X-Team-Id") && c.req.header("X-Team-Id") !== user.teamId)
      return c.json({ error: "This is another team's address." }, 403);
    if (
      !user.isAdmin &&
      !(app === "shop" && (await assignedPermissions(db, user, app)).includes("manage"))
    )
      return c.json({ error: "Admin access required." }, 403);
    c.set("adminTeamId", user.teamId);
    await next();
  })
  .get("/", async (c) => {
    const teamSlack = await slackForTeam(c.env, c.get("adminTeamId") as string);
    if (!teamSlack) {
      return c.json({ code: "no_slack", error: "Your team hasn't connected Slack." }, 404);
    }
    try {
      return c.json({ channels: await listChannels(teamSlack.slack) });
    } catch (err) {
      if (err instanceof SlackApiError && err.code === "missing_scope") {
        return c.json(
          { code: "reconnect", error: "Connect Slack again so Gearbox can list your channels." },
          409,
        );
      }
      console.error("[slack] listing channels failed", err);
      return c.json({ code: "slack_error", error: "Slack didn't answer. Please try again." }, 502);
    }
  });
