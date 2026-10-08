import { deleteTeamRows, hasMentorAccess, requireAuth } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { createDb } from "./db";
import { treeSets } from "./db/schema";
import { currentTreeSet } from "./lib/tree-set";
import { progressRouter, studentsRouter } from "./routes/students";
import { categoriesRouter, skillsRouter, treesRouter } from "./routes/trees";
import type { AppEnv } from "./types";

const base = new Hono<AppEnv>();

base.onError((err, c) => {
  console.error("[skill-tree]", err);
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
    c.json({ status: "ok", service: "skill-tree", version: packageJson.version }),
  )
  // When an operator deletes the team (the platform's console), or 90 days after the team switches
  // the app off (the platform's app library), its data goes too. Only other workers reach
  // /internal: the gateway never answers it.
  .delete("/internal/teams/:teamId", async (c) => {
    // Everything else hangs off the team's tree set and goes with it (ON DELETE CASCADE).
    await deleteTeamRows(createDb(c.env.SKILL_DB), c.req.param("teamId"), [treeSets]);
    return c.json({ ok: true });
  })
  // When the team switches Skill Tree on (the platform's app library): its default trees. Opening
  // the app does the same, so this only gets them ready; a team that has a tree set keeps it.
  .post("/internal/teams/:teamId/seed", async (c) => {
    await currentTreeSet(createDb(c.env.SKILL_DB), c.req.param("teamId"));
    return c.json({ ok: true });
  })
  .get("/me", requireAuth, (c) =>
    c.json({
      userId: c.get("userId"),
      displayName: c.get("userDisplayName"),
      /** G3ID mentors and admins: sign skills off and edit the trees. */
      isMentor: hasMentorAccess(c),
    }),
  )
  .route("/trees", treesRouter)
  .route("/categories", categoriesRouter)
  .route("/skills", skillsRouter)
  .route("/students", studentsRouter)
  .route("/progress", progressRouter);

export type SkillTreeApp = typeof app;
/** The Hono app itself, for the isolation test (test/isolation.test.ts). */
export { app };
export type { LoadSummary, TreeSet } from "./lib/tree-set";
export type { CategoryView, SkillView, TreeView } from "./lib/trees";

export default { fetch: withApiPrefix(app.fetch) };
