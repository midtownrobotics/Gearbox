import type { MessageBatch } from "@cloudflare/workers-types";
import { requireAuth } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { createShopDb } from "./db";
import { type BOMQueueMessage, processBOMQueue } from "./lib/bom-queue-consumer";
import { isShopManager, qualityCheck, qualityReportsOn } from "./lib/quality";
import { checklistFor } from "./lib/quality-checklist";
import {
  type TrackerSyncMessage,
  isTrackerMessage,
  openTrackerWindow,
  runTrackerSync,
} from "./lib/release-tracker";
import { statusLevelsFor } from "./lib/shop-status";
import { actionsRouter } from "./routes/actions";
import { adminPartsRouter } from "./routes/admin-parts";
import { drawingsRouter } from "./routes/drawings";
import { internalRouter } from "./routes/internal";
import { clearPresence, kioskPresenceRouter } from "./routes/kiosk-presence";
import { onshapeExportRouter } from "./routes/onshape-export";
import { onshapeLinksRouter } from "./routes/onshape-links";
import { onshapeUsageRouter } from "./routes/onshape-usage";
import { onshapeWebhooksRouter } from "./routes/onshape-webhooks";
import { partDefinitionsRouter } from "./routes/part-definitions";
import { partFilesRouter } from "./routes/part-files";
import { partInstanceProcessesRouter } from "./routes/part-instance-processes";
import { partInstancesRouter } from "./routes/part-instances";
import { partViewerRouter } from "./routes/part-viewer";
import { printRouter } from "./routes/print";
import { processesRouter } from "./routes/processes";
import { qualityRouter } from "./routes/quality";
import { qualityReportsRouter } from "./routes/quality-reports";
import { releaseTrackerRouter } from "./routes/release-tracker";
import { shopStatusRouter } from "./routes/shop-status";
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

/**
 * After a change that can move a part along in the shop (a step, a batch, a quality report, a
 * new or obsolete part), the release tracker's window opens, if the team has one: its sync, 20
 * minutes later, recolors what changed. Changes inside the window share that one sync.
 */
const openTrackerAfterChange: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (c.req.method === "GET" || !c.res.ok) return;
  const teamId = c.get("teamId");
  if (!teamId) return;
  const opening = openTrackerWindow(c.env, createShopDb(c.env.SHOP_DB), teamId, {
    refresh: false,
  }).catch((err) => console.error("[Release tracker] Window not opened", err));
  try {
    c.executionCtx.waitUntil(opening);
  } catch {
    await opening;
  }
};
for (const path of [
  "/part-instance-processes",
  "/staging-batches",
  "/quality-reports",
  "/part-instances",
  "/part-definitions",
]) {
  base.use(path, openTrackerAfterChange);
  base.use(`${path}/*`, openTrackerAfterChange);
}
base.use("/admin/obsolete-instances", openTrackerAfterChange);

const app = base
  .get("/health", (c) => c.json({ status: "ok", service: "shop", version: packageJson.version }))
  // Also what the pages need about quality checks: whether this person may check a Quality
  // Control step off, and the step every part ends with when the team requires one.
  .get("/me", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const [check, manager, reports, statusLevels] = await Promise.all([
      qualityCheck(db, teamId),
      isShopManager(db, teamId, c.get("userId")),
      qualityReportsOn(db, teamId),
      statusLevelsFor(db, teamId),
    ]);
    // Only a team using reports needs the checklist, and only then is one worth making for it.
    const checklist = reports ? await checklistFor(db, teamId) : [];
    return c.json({
      userId: c.get("userId"),
      isAdmin: c.get("userIsAdmin"),
      email: c.get("userEmail"),
      displayName: c.get("userDisplayName"),
      sessionType: c.get("sessionType"),
      kioskDeviceId: c.get("kioskDeviceId"),
      kioskDeviceName: c.get("kioskDeviceName"),
      isShopManager: manager,
      qualityCheck: check,
      qualityReports: reports,
      qualityChecklist: checklist,
      // The Overview's shop status words, lowest first (lib/shop-status.ts).
      statusLevels,
    });
  })
  .route("/drawings", drawingsRouter)
  .route("/print", printRouter)
  .route("/onshape", onshapeExportRouter)
  .route("/onshape", onshapeLinksRouter)
  .route("", onshapeUsageRouter)
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
  .route("/admin/quality", qualityRouter)
  .route("/admin/shop-status", shopStatusRouter)
  .route("/admin/release-tracker", releaseTrackerRouter)
  .route("/quality-reports", qualityReportsRouter)
  .route("/team-settings", teamSettingsRouter)
  .route("/internal", internalRouter);

export type ShopApp = typeof app;
export { app };

export default {
  fetch: withApiPrefix(app.fetch),
  // One queue for both: a release's BOM job, and the release tracker's syncs (`kind`).
  async queue(batch: MessageBatch<BOMQueueMessage | TrackerSyncMessage>, env: AppEnv["Bindings"]) {
    for (const msg of batch.messages) {
      try {
        if (isTrackerMessage(msg.body)) {
          // Another sync of the team's is running: this one goes after it.
          if ((await runTrackerSync(env, msg.body.teamId)) === "busy") {
            msg.retry({ delaySeconds: 120 });
            continue;
          }
        } else {
          await processBOMQueue(msg.body, env);
        }
        msg.ack();
      } catch (err) {
        console.error("[Queue] Error processing message:", err);
        msg.retry({ delaySeconds: 30 });
      }
    }
  },
};
