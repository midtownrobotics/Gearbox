import { deleteTeamRows, exportTeamRows, hasMentorAccess, requireAuth, teamExport } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { createDb } from "./db";
import {
  fields,
  intakeReceipts,
  itemEvents,
  itemListings,
  items,
  locations,
  robots,
  stock,
  subsystems,
} from "./db/schema";
import { manifest } from "./manifest";
import { intakeRouter } from "./routes/intake";
import { inventoryRouter } from "./routes/inventory";
import { itemsRouter } from "./routes/items";
import { locationContentsRouter } from "./routes/location-contents";
import {
  fieldsRouter,
  locationsRouter,
  robotsRouter,
  setupRouter,
  subsystemsRouter,
} from "./routes/settings";
import { stockRouter } from "./routes/stock";
import type { AppEnv } from "./types";

const base = new Hono<AppEnv>();

base.onError((err, c) => {
  console.error("[inventory]", err);
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
    c.json({ status: "ok", service: "inventory", version: packageJson.version }),
  )
  // When an operator deletes the team (the platform's console), or 90 days after the team switches
  // the app off (the platform's app library), its data goes too. Only other workers reach
  // /internal: the gateway never answers it.
  // The team's data, for its admins to download before switching the app off (the platform's app
  // library). Only other workers reach /internal.
  .get("/internal/teams/:teamId/export", async (c) => {
    const teamId = c.req.param("teamId");
    const tables = await exportTeamRows(createDb(c.env.INVENTORY_DB), teamId, [
      fields,
      locations,
      robots,
      subsystems,
      items,
      itemListings,
      stock,
      itemEvents,
      intakeReceipts,
    ]);
    return c.json(teamExport(manifest, teamId, tables));
  })
  .delete("/internal/teams/:teamId", async (c) => {
    await deleteTeamRows(createDb(c.env.INVENTORY_DB), c.req.param("teamId"), [
      stock,
      itemEvents,
      intakeReceipts,
      itemListings,
      items,
      locations,
      robots,
      subsystems,
      fields,
    ]);
    return c.json({ ok: true });
  })
  .get("/me", requireAuth, (c) =>
    c.json({
      userId: c.get("userId"),
      displayName: c.get("userDisplayName"),
      /** G3ID mentors and admins: delete, merge and split entries. */
      isMentor: hasMentorAccess(c),
      /** G3ID admins: the Settings page. */
      isAdmin: c.get("userIsAdmin"),
    }),
  )
  .route("/", inventoryRouter)
  .route("/items", itemsRouter)
  .route("/stock", stockRouter)
  .route("/fields", fieldsRouter)
  .route("/locations", locationsRouter)
  .route("/locations", locationContentsRouter)
  .route("/robots", robotsRouter)
  .route("/subsystems", subsystemsRouter)
  .route("/setup", setupRouter)
  .route("/intake", intakeRouter);

export type InventoryApp = typeof app;
/** The Hono app itself, for the isolation test (test/isolation.test.ts). */
export { app };
export type { FieldValue, FieldValues, FieldView } from "./lib/fields";
export type { ItemView, ListingInput, ListingView, StockView } from "./lib/items";
export type { LocationRow } from "./lib/locations";
export type { Setup, SetupSummary } from "./lib/setup";
export type { FieldType, StockStatus } from "./db/schema";

export default { fetch: withApiPrefix(app.fetch) };
