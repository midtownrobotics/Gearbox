import { inTeam, requireAuth } from "@g3/auth";
import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createOrdersDb } from "../db";
import { orderRequests } from "../db/schema";
import { inChunks } from "../lib/chunks";
import { inventoryDefaults, inventoryOptions, inventoryRequired } from "../lib/inventory";
import type { AppEnv } from "../types";

const idsValidator = validator("json", (value, c): { ids: number[] } => {
  const ids = (value as { ids?: unknown } | null)?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 200 ||
    !ids.every((id) => Number.isInteger(id) && id > 0)
  ) {
    return c.json({ error: "ids must be 1–200 request ids." }, 400) as never;
  }
  return { ids: [...new Set(ids as number[])] };
});

export const inventoryRouter = new Hono<AppEnv>()
  /**
   * What the pages need to ask where received parts go: whether that's required, and Inventory's
   * locations, robots and subsystems (null when Inventory can't be reached).
   */
  .get("/", requireAuth, async (c) => {
    const [required, options] = await Promise.all([
      inventoryRequired(createOrdersDb(c.env.ORDERS_DB), c.get("teamId")),
      inventoryOptions(c),
    ]);
    return c.json({ required, options });
  })
  /**
   * Where each of these requests' parts would go if nobody said otherwise, by request id: with
   * the entry Inventory already has for the part, else where the same part went the last time it
   * was received. A request with neither isn't in the answer.
   */
  .post("/defaults", requireAuth, idsValidator, async (c) => {
    const { ids } = c.req.valid("json");
    const db = createOrdersDb(c.env.ORDERS_DB);
    const lines = await inChunks(ids, (chunk) =>
      db
        .select({
          id: orderRequests.id,
          title: orderRequests.title,
          vendor: orderRequests.vendor,
          sku: orderRequests.sku,
          url: orderRequests.url,
          quantity: orderRequests.quantity,
          packQuantity: orderRequests.packQuantity,
          unitPriceCents: orderRequests.unitPriceCents,
          lineTotalCents: orderRequests.lineTotalCents,
          catalogItemId: orderRequests.catalogItemId,
          orderId: orderRequests.orderId,
        })
        .from(orderRequests)
        .where(inTeam(orderRequests, c.get("teamId"), inArray(orderRequests.id, chunk)))
        .all(),
    );
    return c.json({ defaults: await inventoryDefaults(c, db, lines) });
  });
