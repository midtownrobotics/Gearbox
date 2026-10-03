import { requireAuth } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { requireAgent } from "./middleware/auth";
import { lookupRouter } from "./modules/lookup/routes";
import { networkAgentRouter, networkRouter, networkScheduled } from "./modules/network";
import { printRouter } from "./modules/print/routes";
import { switchRouter } from "./modules/switch/routes";
import { statusRouter } from "./routes/status";
import type { AppEnv } from "./types";

const base = new Hono<AppEnv>();

base.onError((err, c) => {
  console.error(err);
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
  .get("/health", (c) => c.json({ status: "ok", service: "edge", version: packageJson.version }))
  .get("/me", requireAuth, (c) =>
    c.json({
      userId: c.get("userId"),
      displayName: c.get("userDisplayName"),
      isAdmin: c.get("userIsAdmin"),
    }),
  )
  .route("/status", statusRouter)
  .route("/network", networkRouter)
  .route("/print", printRouter)
  .route("/lookup", lookupRouter)
  .route("/switch", switchRouter)
  // Agent-facing routes (shared-key auth), one prefix per module.
  // The agent calls this right after applying new state; requireAgent records the
  // applied version (X-G3-Agent-State-Version) so the UI can clear "pending".
  .post("/agent/ack", requireAgent, (c) => c.json({ ok: true }))
  .route("/agent/network", networkAgentRouter);

export type EdgeApp = typeof app;

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: AppEnv["Bindings"]) {
    await networkScheduled(env);
  },
};
