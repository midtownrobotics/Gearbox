import { requireAuth } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { createEdgeDb } from "./db";
import { CONNECT_PATH, agentLink } from "./lib/agent-link";
import { recordAgentContact, requireAgent, requireAgentKey } from "./middleware/auth";
import { lookupRouter } from "./modules/lookup/routes";
import { networkAgentRouter, networkRouter, networkScheduled } from "./modules/network";
import { teamTimeZone } from "./modules/network/common";
import { printRouter } from "./modules/print/routes";
import { switchRouter } from "./modules/switch/routes";
import { boxRouter } from "./routes/box";
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
  .get("/me", requireAuth, async (c) =>
    c.json({
      userId: c.get("userId"),
      displayName: c.get("userDisplayName"),
      isAdmin: c.get("userIsAdmin"),
      /** The team's box's time zone (UTC until it has said): pages show its days and times. */
      timeZone: await teamTimeZone(createEdgeDb(c.env.EDGE_DB), c.get("teamId")),
    }),
  )
  .route("/status", statusRouter)
  .route("/box", boxRouter)
  .route("/network", networkRouter)
  .route("/print", printRouter)
  .route("/lookup", lookupRouter)
  .route("/switch", switchRouter)
  // Agent-facing routes (the team's box key, on its team's address), one prefix per module.
  // The agent calls this right after applying new state; requireAgent records the
  // applied version (X-G3-Agent-State-Version) so the UI can clear "pending".
  .post("/agent/ack", requireAgent, (c) => c.json({ ok: true }))
  // The team's box link: it opens this WebSocket and keeps it open; the worker sends
  // its requests to the agent over it (lib/agent-link.ts, one per team).
  .get("/agent/connect", requireAgentKey, (c) => {
    recordAgentContact(c);
    return agentLink(c.env, c.get("teamId")).fetch(
      new Request(`http://agent${CONNECT_PATH}`, c.req.raw),
    );
  })
  .route("/agent/network", networkAgentRouter);

export type EdgeApp = typeof app;
export { app };

export { AgentLink } from "./lib/agent-link";

export default {
  fetch: withApiPrefix(app.fetch),
  async scheduled(_controller: ScheduledController, env: AppEnv["Bindings"]) {
    await networkScheduled(env);
  },
};
