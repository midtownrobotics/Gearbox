import { hasMentorAccess, requireAuth, withTeam } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { createOrdersDb } from "./db";
import { appUsers } from "./db/schema";
import { TIME_ZONE_HEADER } from "./lib/local-time";
import { teamSettings } from "./lib/settings";
import { catalogReady } from "./lib/starter";
import { canEditCatalog } from "./middleware/auth";
import { catalogRouter } from "./routes/catalog";
import { categoriesRouter } from "./routes/categories";
import { categoryRulesRouter, settingsRouter, suggestRouter } from "./routes/fast-entry";
import { internalRouter } from "./routes/internal";
import { inventoryRouter } from "./routes/inventory";
import { listsRouter } from "./routes/lists";
import { lookupRouter } from "./routes/lookup";
import { ordersRouter } from "./routes/orders";
import { requestsRouter } from "./routes/requests";
import { shareACartRouter } from "./routes/share-a-cart";
import { trustedRouter } from "./routes/trusted";
import { vendorsRouter } from "./routes/vendors";
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
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", TIME_ZONE_HEADER],
    credentials: true,
  }),
);

const app = base
  .get("/health", (c) => c.json({ status: "ok", service: "orders", version: packageJson.version }))
  /** Who's signed in, and the team's settings every page needs (money, calendar). */
  .get("/me", requireAuth, catalogReady, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const teamId = c.get("teamId");
    const now = Date.now();
    // Remembered so mentors can find people to mark trusted on the Settings page.
    await db
      .insert(appUsers)
      .values(
        withTeam(teamId, { id: c.get("userId"), name: c.get("userDisplayName"), lastSeenAt: now }),
      )
      .onConflictDoUpdate({
        target: appUsers.id,
        set: { teamId, name: c.get("userDisplayName"), lastSeenAt: now },
      });
    const settings = await teamSettings(db, teamId);
    return c.json({
      userId: c.get("userId"),
      displayName: c.get("userDisplayName"),
      isMentor: hasMentorAccess(c),
      canEditCatalog: await canEditCatalog(c),
      currency: settings.currency,
      fiscalYearStart: settings.fiscalYearStart,
    });
  })
  .route("/lookup", lookupRouter)
  .route("/categories", categoriesRouter)
  .route("/requests", requestsRouter)
  .route("/orders", ordersRouter)
  .route("/vendors", vendorsRouter)
  .route("/settings", settingsRouter)
  .route("/category-rules", categoryRulesRouter)
  .route("/suggest", suggestRouter)
  .route("/share-a-cart", shareACartRouter)
  .route("/catalog", catalogRouter)
  .route("/trusted", trustedRouter)
  .route("/lists", listsRouter)
  .route("/inventory", inventoryRouter)
  .route("/internal", internalRouter);

export type OrdersApp = typeof app;
export { app };
export type { ImportSummary } from "./lib/sheet-import";

export default { fetch: withApiPrefix(app.fetch) };
