import { hasMentorAccess, requireAuth } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
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
