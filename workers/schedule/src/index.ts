import { deleteTeamRows, exportTeamRows, hasMentorAccess, requireAuth, teamExport } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { createDb } from "./db";
import { events } from "./db/schema";
import { manifest } from "./manifest";
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
    const tables = await exportTeamRows(createDb(c.env.SCHEDULE_DB), teamId, [events]);
    return c.json(teamExport(manifest, teamId, tables));
  })
  // When an operator deletes the team (the platform's console), or 90 days after the team switches
  // the app off (the platform's app library), its data goes too.
  .delete("/internal/teams/:teamId", async (c) => {
    await deleteTeamRows(createDb(c.env.SCHEDULE_DB), c.req.param("teamId"), [events]);
    return c.json({ ok: true });
  })
  .get("/me", requireAuth, (c) =>
    c.json({
      userId: c.get("userId"),
      displayName: c.get("userDisplayName"),
      /** G3ID mentors and admins. */
      isMentor: hasMentorAccess(c),
      /** G3ID admins: the Admin page. */
      isAdmin: c.get("userIsAdmin"),
    }),
  );

export type ScheduleApp = typeof app;
/** The Hono app itself, for the isolation test (test/isolation.test.ts). */
export { app };

export default { fetch: withApiPrefix(app.fetch) };
