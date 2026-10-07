import { requireAuth } from "@g3/auth";
import { asc } from "drizzle-orm";
import { Hono } from "hono";
import { type Db, createDb } from "../db";
import { robots, subsystems } from "../db/schema";
import { loadFields } from "../lib/fields";
import type { InventoryOptions } from "../lib/intake-types";
import { loadItems } from "../lib/items";
import { loadLocations } from "../lib/locations";
import type { AppEnv } from "../types";

// What every page starts from. Anyone signed in reads it, kiosk sessions included.

/** Where parts can be: the team's locations, robots and subsystems, each in its order. */
async function loadOptions(db: Db): Promise<InventoryOptions> {
  const named = (table: typeof robots | typeof subsystems) =>
    db
      .select({ id: table.id, name: table.name })
      .from(table)
      .orderBy(asc(table.sortOrder), asc(table.id))
      .all();
  const [locations, robotRows, subsystemRows] = await Promise.all([
    loadLocations(db),
    named(robots),
    named(subsystems),
  ]);
  return { locations, robots: robotRows, subsystems: subsystemRows };
}

export const inventoryRouter = new Hono<AppEnv>()
  /** The main table: every entry with its stock and listings, and what they're described by. */
  .get("/inventory", requireAuth, async (c) => {
    const db = createDb(c.env.INVENTORY_DB);
    const [fields, options, items] = await Promise.all([
      loadFields(db),
      loadOptions(db),
      loadItems(db),
    ]);
    return c.json({ fields, ...options, items });
  })
  /** Just the places, for picking where something goes (Orders asks when a part is received). */
  .get("/options", requireAuth, async (c) => {
    return c.json(await loadOptions(createDb(c.env.INVENTORY_DB)));
  });
