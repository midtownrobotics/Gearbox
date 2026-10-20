import { deleteTeamRows, exportTeamRows, hasMentorAccess, requireAuth, teamExport } from "@g3/auth";
import { isDemoTeam } from "@g3/demo";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { createDb } from "./db";
import { EXPORTED_TABLES, TEAM_TABLES } from "./db/schema";
import { demoWords, loadDemo } from "./demo";
import { canEdit } from "./lib/editors";
import { eventDays } from "./lib/event-days";
import { peopleNow } from "./lib/now";
import { isRoleType } from "./lib/roles";
import { manifest } from "./manifest";
import { sendReminders } from "./reminders";
import { friendsRouter } from "./routes/friends";
import { nowRouter } from "./routes/now";
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
  // The public demo (roadmap Phase 5): its sample data, after the nightly reset deleted the
  // team's, and the words in it, which the gateway lets demo visitors send.
  .post("/internal/teams/:teamId/demo", async (c) => {
    const teamId = c.req.param("teamId");
    if (!isDemoTeam(teamId)) return c.json({ error: "Only the demo team." }, 403);
    return c.json(await loadDemo(createDb(c.env.SCHEDULE_DB), teamId));
  })
  .get("/internal/demo/words", (c) => c.json({ words: demoWords() }))
  .get("/internal/teams/:teamId/export", async (c) => {
    const teamId = c.req.param("teamId");
    const tables = await exportTeamRows(createDb(c.env.SCHEDULE_DB), teamId, [...EXPORTED_TABLES]);
    return c.json(
      teamExport(manifest, teamId, tables, [
        "Each member's friends are private to them, so they aren't included.",
      ]),
    );
  })
  // Who has a role of a type right now (`?type=scouting`), for other workers: Scouting's inactive
  // scouts. The same answer as /now, without a person signed in.
  .get("/internal/teams/:teamId/now", async (c) => {
    const type = c.req.query("type");
    if (!isRoleType(type)) return c.json({ error: "Unknown role type." }, 400);
    const people = await peopleNow(c.env, createDb(c.env.SCHEDULE_DB), c.req.param("teamId"), type);
    return c.json({ people });
  })
  // When the team's events open and close each day: Pit's battery timers pause overnight.
  .get("/internal/teams/:teamId/event-days", async (c) =>
    c.json({ events: await eventDays(createDb(c.env.SCHEDULE_DB), c.req.param("teamId")) }),
  )
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
  .route("/friends", friendsRouter)
  .route("/now", nowRouter);

export type ScheduleApp = typeof app;
/** The Hono app itself, for the isolation test (test/isolation.test.ts). */
export { app };

export type { PersonNow } from "./lib/now";
export type { AssignmentRange } from "./lib/schedules";
export {
  ROLE_COLORS,
  ROLE_TYPES,
  type RoleColor,
  type RolePreset,
  type RoleType,
} from "./lib/roles";

export default {
  fetch: withApiPrefix(app.fetch),
  // Slack or Discord reminders before role changes (wrangler.toml's cron: every minute).
  scheduled: (_event: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) => {
    ctx.waitUntil(sendReminders(env));
  },
};
