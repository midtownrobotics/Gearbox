import { deleteTeamRows, exportTeamRows, hasMentorAccess, requireAuth, teamExport } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { createDb } from "./db";
import { EXPORTED_TABLES, TEAM_TABLES } from "./db/schema";
import { canEdit } from "./lib/editors";
import { manifest } from "./manifest";
import { sendReminders } from "./reminders";
import { friendsRouter } from "./routes/friends";
import { editorsRouter, membersRouter } from "./routes/people";
import { rolesRouter } from "./routes/roles";
import { schedulesRouter } from "./routes/schedules";
import type { AppEnv } from "./types";

const base = new Hono<AppEnv>();

base.onError((err, c) => {
  console.error("[schedule]", err);
  return c.json({ error: "Internal server error." }, 500);
});

base.use(
  "*",
  cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    credentials: true,
  }),
);

const app = base
  .get("/health", (c) =>
    c.json({ status: "ok", service: "schedule", version: packageJson.version }),
  )
  // The team's data, for its admins to download before switching the app off (the platform's app
  // library). Only other workers reach /internal: the gateway never answers it.
  .get("/internal/teams/:teamId/export", async (c) => {
    const teamId = c.req.param("teamId");
    const tables = await exportTeamRows(createDb(c.env.SCHEDULE_DB), teamId, [...EXPORTED_TABLES]);
    return c.json(
      teamExport(manifest, teamId, tables, [
        "Each member's friends are private to them, so they aren't included.",
      ]),
    );
  })
  // When an operator deletes the team (the platform's console), or 90 days after the team switches
  // the app off (the platform's app library), its data goes too.
  .delete("/internal/teams/:teamId", async (c) => {
    await deleteTeamRows(createDb(c.env.SCHEDULE_DB), c.req.param("teamId"), [...TEAM_TABLES]);
    return c.json({ ok: true });
  })
  .get("/me", requireAuth, async (c) =>
    c.json({
      userId: c.get("userId"),
      displayName: c.get("userDisplayName"),
      /** G3ID mentors and admins: the Admin page, and choosing who else edits. */
      isMentor: hasMentorAccess(c),
      /** G3ID admins. */
      isAdmin: c.get("userIsAdmin"),
      /** Mentors, admins and trusted students: making and changing schedules, drafts included. */
      canEdit: await canEdit(c),
    }),
  )
  .route("/schedules", schedulesRouter)
  .route("/roles", rolesRouter)
  .route("/members", membersRouter)
  .route("/editors", editorsRouter)
  .route("/friends", friendsRouter);

export type ScheduleApp = typeof app;
/** The Hono app itself, for the isolation test (test/isolation.test.ts). */
export { app };

export type { AssignmentRange } from "./lib/schedules";
export { ROLE_COLORS, type RoleColor, type RolePreset } from "./lib/roles";

export default {
  fetch: withApiPrefix(app.fetch),
  // Slack reminders before role changes (wrangler.toml's cron: every minute).
  scheduled: (_event: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) => {
    ctx.waitUntil(sendReminders(env));
  },
};
