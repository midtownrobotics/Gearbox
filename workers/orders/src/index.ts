import { hasMentorAccess, requireAuth } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { canEditCatalog } from "./middleware/auth";
import { catalogRouter } from "./routes/catalog";
import { categoriesRouter } from "./routes/categories";
import { categoryRulesRouter, settingsRouter, suggestRouter } from "./routes/fast-entry";
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
    allowHeaders: ["Content-Type"],
    credentials: true,
  }),
);

const app = base
  .get("/health", (c) => c.json({ status: "ok", service: "orders", version: "v0.1.0" }))
  .get("/me", requireAuth, async (c) => {
    // Remembered so mentors can find people to mark trusted on the Settings page.
    await c.env.ORDERS_DB.prepare(
      `INSERT INTO app_users (id, name, last_seen_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (id) DO UPDATE SET name = ?2, last_seen_at = ?3`,
    )
      .bind(c.get("userId"), c.get("userDisplayName"), Date.now())
      .run();
    return c.json({
      userId: c.get("userId"),
      displayName: c.get("userDisplayName"),
      isMentor: hasMentorAccess(c),
      canEditCatalog: await canEditCatalog(c),
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
  .route("/lists", listsRouter);

export type OrdersApp = typeof app;
export type { ImportSummary } from "./lib/sheet-import";

export default { fetch: app.fetch };
