import type { MessageBatch } from "@cloudflare/workers-types";
import { requireAuth } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { createShopDb } from "./db";
import { type BOMQueueMessage, processBOMQueue } from "./lib/bom-queue-consumer";
import { actionsRouter } from "./routes/actions";
import { adminPartsRouter } from "./routes/admin-parts";
import { drawingsRouter } from "./routes/drawings";
import { internalRouter } from "./routes/internal";
import { clearPresence, kioskPresenceRouter } from "./routes/kiosk-presence";
import { onshapeExportRouter } from "./routes/onshape-export";
import { onshapeWebhooksRouter } from "./routes/onshape-webhooks";
import { partDefinitionsRouter } from "./routes/part-definitions";
import { partFilesRouter } from "./routes/part-files";
import { partInstanceProcessesRouter } from "./routes/part-instance-processes";
import { partInstancesRouter } from "./routes/part-instances";
import { partViewerRouter } from "./routes/part-viewer";
import { printRouter } from "./routes/print";
import { processesRouter } from "./routes/processes";
import { stagingBatchesRouter } from "./routes/staging-batches";
import { subsystemsRouter } from "./routes/subsystems";
import { teamSettingsRouter } from "./routes/team-settings";
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
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

const app = base
  .get("/health", (c) => c.json({ status: "ok", service: "shop", version: packageJson.version }))
  .get("/me", requireAuth, (c) =>
    c.json({
      userId: c.get("userId"),
      isAdmin: c.get("userIsAdmin"),
      email: c.get("userEmail"),
      displayName: c.get("userDisplayName"),
      sessionType: c.get("sessionType"),
      kioskDeviceId: c.get("kioskDeviceId"),
      kioskDeviceName: c.get("kioskDeviceName"),
    }),
  )
  .route("/drawings", drawingsRouter)
  .route("/print", printRouter)
  .route("/onshape", onshapeExportRouter)
  .route("", partViewerRouter)
  // Proxy logout to g3id so the shop app can end sessions (and clean up kiosk
  // presence) without talking to the g3id worker directly.
  .post("/logout", requireAuth, async (c) => {
    const kioskDeviceId = c.get("kioskDeviceId");
    if (c.get("sessionType") === "pin" && kioskDeviceId) {
      await clearPresence(createShopDb(c.env.SHOP_DB), c.get("teamId"), kioskDeviceId);
    }
    const res = await c.env.G3ID.fetch(
      new Request("http://g3id/api/auth/logout", {
        method: "POST",
        headers: { cookie: c.req.header("Cookie") ?? "" },
      }),
    );
    // Forward the session-clearing cookie from g3id to the browser.
    const setCookie = res.headers.get("Set-Cookie");
    if (setCookie) c.header("Set-Cookie", setCookie);
    return c.json({ ok: true });
  })
  // Resolve user IDs (e.g. part creators) to display names via g3id.
  .get("/users", requireAuth, async (c) => {
    const ids = c.req.query("ids") ?? "";
    const res = await c.env.G3ID.fetch(
      new Request(`http://g3id/api/auth/users?ids=${encodeURIComponent(ids)}`, {
        headers: { cookie: c.req.header("Cookie") ?? "" },
      }),
    );
    if (!res.ok) return c.json({ error: "Failed to resolve users." }, 502);
    return c.json((await res.json()) as { id: string; displayName: string }[]);
  })
  .route("/onshape", onshapeWebhooksRouter)
  .route("/subsystems", subsystemsRouter)
  .route("/processes", processesRouter)
  .route("/part-definitions", partDefinitionsRouter)
  .route("/part-instances", partInstancesRouter)
  .route("/part-instance-processes", partInstanceProcessesRouter)
  .route("/part-files", partFilesRouter)
  .route("/staging-batches", stagingBatchesRouter)
  .route("/actions", actionsRouter)
  .route("/kiosk-presence", kioskPresenceRouter)
  .route("/admin", adminPartsRouter)
  .route("/team-settings", teamSettingsRouter)
  .route("/internal", internalRouter);

export type ShopApp = typeof app;
export { app };

export default {
  fetch: withApiPrefix(app.fetch),
  async queue(batch: MessageBatch<BOMQueueMessage>, env: AppEnv["Bindings"]) {
    for (const msg of batch.messages) {
      try {
        await processBOMQueue(msg.body, env);
        msg.ack();
      } catch (err) {
        console.error("[Queue] Error processing message:", err);
        msg.retry({ delaySeconds: 30 });
      }
    }
  },
};
