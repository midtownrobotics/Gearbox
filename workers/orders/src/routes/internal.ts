import { deleteTeamRows, exportTeamRows, teamExport } from "@g3/auth";
import { Hono } from "hono";
import { createOrdersDb } from "../db";
import {
  appSettings,
  appUsers,
  budgetCategories,
  catalogCategories,
  catalogFamilies,
  catalogItems,
  categoryBudgets,
  categoryRules,
  orderCharges,
  orderRequests,
  partListItems,
  partLists,
  requestEvents,
  vendorCredits,
  vendorOrders,
  vendors,
} from "../db/schema";
import { ensureCatalog, forgetCatalog } from "../lib/starter";
import { manifest } from "../manifest";
import type { AppEnv } from "../types";

/**
 * For other workers only: the gateway never answers /internal. When an operator deletes a team
 * (the platform's console), or 90 days after the team switches Orders off (the platform's app
 * library), its data here goes too: every table but the shared lookup cache.
 */
export const internalRouter = new Hono<AppEnv>()
  // When the team switches Orders on (the platform's app library): its copy of the starter parts
  // catalog. Opening Orders does the same, so this only gets it ready; a team that has its copy
  // keeps it.
  .post("/teams/:teamId/seed", async (c) => {
    await ensureCatalog(createOrdersDb(c.env.ORDERS_DB), c.req.param("teamId"));
    return c.json({ ok: true });
  })
  // The team's data, for its admins to download before switching Orders off (the platform's app
  // library). Share-A-Cart's connection (`sac_*` settings, encrypted tokens) is left out.
  .get("/teams/:teamId/export", async (c) => {
    const teamId = c.req.param("teamId");
    const tables = await exportTeamRows(createOrdersDb(c.env.ORDERS_DB), teamId, [
      appSettings,
      appUsers,
      budgetCategories,
      categoryBudgets,
      categoryRules,
      catalogCategories,
      catalogFamilies,
      catalogItems,
      vendors,
      vendorCredits,
      vendorOrders,
      orderCharges,
      orderRequests,
      requestEvents,
      partLists,
      partListItems,
    ]);
    tables.app_settings = (tables.app_settings ?? []).filter(
      (row) => !String(row.key).startsWith("sac_"),
    );
    return c.json(
      teamExport(manifest, teamId, tables, [
        "Share-A-Cart's connection isn't included: connect the account again on Settings.",
      ]),
    );
  })
  .delete("/teams/:teamId", async (c) => {
    const teamId = c.req.param("teamId");
    // Rows before the rows they point at.
    await deleteTeamRows(createOrdersDb(c.env.ORDERS_DB), teamId, [
      partListItems,
      partLists,
      requestEvents,
      orderCharges,
      categoryBudgets,
      vendorCredits,
      categoryRules,
      vendors,
      orderRequests,
      vendorOrders,
      catalogItems,
      catalogFamilies,
      catalogCategories,
      budgetCategories,
      appUsers,
      appSettings,
    ]);
    forgetCatalog(teamId);
    return c.json({ ok: true });
  });
