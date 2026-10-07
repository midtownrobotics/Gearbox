import { deleteTeamRows } from "@g3/auth";
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
import { forgetCatalog } from "../lib/starter";
import type { AppEnv } from "../types";

/**
 * For other workers only: the gateway never answers /internal. When an operator deletes a team
 * (the platform's console), its data here goes too: every table but the shared lookup cache.
 */
export const internalRouter = new Hono<AppEnv>().delete("/teams/:teamId", async (c) => {
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
