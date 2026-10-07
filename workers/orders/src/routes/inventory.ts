import { requireAuth } from "@g3/auth";
import { Hono } from "hono";
import { createOrdersDb } from "../db";
import { inventoryOptions, inventoryRequired } from "../lib/inventory";
import type { AppEnv } from "../types";

/**
 * What the pages need to ask where received parts go: whether that's required, and Inventory's
 * locations, robots and subsystems (null when Inventory can't be reached).
 */
export const inventoryRouter = new Hono<AppEnv>().get("/", requireAuth, async (c) => {
  const [required, options] = await Promise.all([
    inventoryRequired(createOrdersDb(c.env.ORDERS_DB)),
    inventoryOptions(c),
  ]);
  return c.json({ required, options });
});
