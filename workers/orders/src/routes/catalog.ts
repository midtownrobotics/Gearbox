import { requireAuth } from "@g3/auth";
import { asc, count, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type OrdersDb, createOrdersDb } from "../db";
import { catalogCategories, catalogFamilies, catalogItems, orderRequests } from "../db/schema";
import { catalogKey, linkKindOf } from "../lib/catalog";
import { packQuantityField } from "../lib/pack-quantity";
import { vendorName } from "../lib/vendors";
import { requireCatalogEditor } from "../middleware/auth";
import type { AppEnv } from "../types";

type ItemFields = {
  name: string;
  category: string;
  vendor: string;
  sku: string | null;
  url: string;
  options: Record<string, string>;
  /** How many parts one unit is: 4 for a pack of 4. */
  packQuantity: number;
};

/** A catalog item, created or edited by anyone. */
const itemValidator = (partial: boolean) =>
  validator("json", (value, c): Partial<ItemFields> => {
    const v = (value ?? {}) as Record<string, unknown>;
    const out: Partial<ItemFields> = {};
    const fail = (error: string) => c.json({ error }, 400) as never;
    const has = (key: string) => !partial || v[key] !== undefined;
    for (const [key, max] of [
      ["name", 300],
      ["category", 100],
      ["vendor", 100],
    ] as const) {
      if (!has(key)) continue;
      const text = typeof v[key] === "string" ? (v[key] as string).trim() : "";
      if (!text || text.length > max) return fail(`${key} must be 1–${max} characters.`);
      out[key] = key === "vendor" ? vendorName(text) : text;
    }
    if (v.sku !== undefined) {
      if (v.sku !== null && (typeof v.sku !== "string" || v.sku.length > 100)) {
        return fail("sku must be text up to 100 characters.");
      }
      out.sku = (v.sku as string | null)?.trim() || null;
    }
    if (has("url")) {
      try {
        const url = new URL(String(v.url));
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
        out.url = url.toString();
      } catch {
        return fail("url must be a link (http or https).");
      }
    }
    if (v.packQuantity !== undefined) {
      const pack = packQuantityField(v.packQuantity);
      if (pack === null) return fail("packQuantity must be a whole number from 1 to 10000.");
      out.packQuantity = pack;
    }
    if (v.options !== undefined) {
      const o = v.options as Record<string, unknown>;
      if (!o || typeof o !== "object" || Array.isArray(o))
        return fail("options must be an object.");
      const entries = Object.entries(o).filter(
        ([k, val]) => typeof val === "string" && k.trim() && val.trim(),
      ) as [string, string][];
      if (entries.length > 20) return fail("Up to 20 options.");
      out.options = Object.fromEntries(entries.map(([k, val]) => [k.trim(), val.trim()]));
    }
    return out;
  });

const itemColumns = {
  id: catalogItems.id,
  familyId: catalogItems.familyId,
  category: catalogItems.category,
  name: catalogItems.name,
  vendor: catalogItems.vendor,
  sku: catalogItems.sku,
  options: catalogItems.options,
  url: catalogItems.url,
  linkKind: catalogItems.linkKind,
  image: catalogItems.image,
  priceCents: catalogItems.priceCents,
  priceAt: catalogItems.priceAt,
  packQuantity: catalogItems.packQuantity,
  storePlatform: catalogItems.storePlatform,
  storeVariantId: catalogItems.storeVariantId,
  source: catalogItems.source,
  requestCount: catalogItems.requestCount,
};

const parsed = <T extends { options: string }>(row: T) => ({
  ...row,
  options: JSON.parse(row.options) as Record<string, string>,
});

const nameValidator = validator("json", (value, c): { name: string } => {
  const name =
    typeof (value as { name?: unknown })?.name === "string"
      ? (value as { name: string }).name.trim()
      : "";
  if (!name || name.length > 100) {
    return c.json({ error: "Name it (up to 100 characters)." }, 400) as never;
  }
  return { name };
});

const NO_CATEGORY = { error: "Pick one of the catalog's categories." };

/** The catalog's categories, A–Z. */
async function categoryNames(db: OrdersDb) {
  const rows = await db
    .select({ name: catalogCategories.name })
    .from(catalogCategories)
    .orderBy(asc(catalogCategories.name))
    .all();
  return rows.map((r) => r.name);
}

/** Fields that follow from the link: what kind it is and its matching key. */
const linkFields = (url: string) => {
  const linkKind = linkKindOf(url);
  return { linkKind, productKey: linkKind === "product" ? catalogKey(url, null) : null };
};

/**
 * The product catalog: anyone logged in can browse and request (new links join it then); mentors
 * and trusted students add categories and add, edit or delete parts. The whole catalog is small
 * enough (a few thousand items) for the app to load at once and search in the browser.
 */
export const catalogRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const [categories, families, items] = await Promise.all([
      categoryNames(db),
      db
        .select({
          id: catalogFamilies.id,
          name: catalogFamilies.name,
          category: catalogFamilies.category,
          sourceUrl: catalogFamilies.sourceUrl,
        })
        .from(catalogFamilies)
        .all(),
      db.select(itemColumns).from(catalogItems).orderBy(asc(catalogItems.name)).all(),
    ]);
    return c.json({ categories, families, items: items.map(parsed) });
  })
  /** Just the catalog's categories (New Request's picker for parts new to the catalog). */
  .get("/categories", requireAuth, async (c) => {
    return c.json(await categoryNames(createOrdersDb(c.env.ORDERS_DB)));
  })
  .post("/categories", requireAuth, requireCatalogEditor, nameValidator, async (c) => {
    const { name } = c.req.valid("json");
    const db = createOrdersDb(c.env.ORDERS_DB);
    const existing = (await categoryNames(db)).find((n) => n.toLowerCase() === name.toLowerCase());
    if (existing) return c.json({ error: `“${existing}” already exists.` }, 409);
    await db
      .insert(catalogCategories)
      .values({ name, createdBy: c.get("userDisplayName"), createdAt: Date.now() });
    return c.json({ name }, 201);
  })
  /**
   * Removing a category. Its parts (and part families) move to `moveTo` first, in the same batch,
   * so no part is ever left in a category that's gone; a category with no parts needs no `moveTo`.
   */
  .delete(
    "/categories",
    requireAuth,
    requireCatalogEditor,
    validator("json", (value, c): { name: string; moveTo: string | null } => {
      const v = (value ?? {}) as { name?: unknown; moveTo?: unknown };
      if (typeof v.name !== "string" || !v.name.trim()) {
        return c.json({ error: "Say which category to remove." }, 400) as never;
      }
      const moveTo = typeof v.moveTo === "string" && v.moveTo.trim() ? v.moveTo.trim() : null;
      return { name: v.name.trim(), moveTo };
    }),
    async (c) => {
      const { name, moveTo } = c.req.valid("json");
      const db = createOrdersDb(c.env.ORDERS_DB);
      const names = await categoryNames(db);
      if (!names.includes(name)) return c.json({ error: `There's no category “${name}”.` }, 404);
      const [{ parts }] = await db
        .select({ parts: count() })
        .from(catalogItems)
        .where(eq(catalogItems.category, name));
      const [{ families }] = await db
        .select({ families: count() })
        .from(catalogFamilies)
        .where(eq(catalogFamilies.category, name));
      if (parts + families > 0) {
        if (!moveTo) {
          return c.json(
            { error: `“${name}” has ${parts} parts. Pick the category to move them to.` },
            400,
          );
        }
        if (moveTo === name) return c.json({ error: "Move them to a different category." }, 400);
        if (!names.includes(moveTo)) return c.json(NO_CATEGORY, 400);
      }
      const now = Date.now();
      const user = c.get("userDisplayName");
      await db.batch([
        db
          .update(catalogItems)
          .set({ category: moveTo ?? name, updatedBy: user, updatedAt: now })
          .where(eq(catalogItems.category, name)),
        db
          .update(catalogFamilies)
          .set({ category: moveTo ?? name })
          .where(eq(catalogFamilies.category, name)),
        db.delete(catalogCategories).where(eq(catalogCategories.name, name)),
      ]);
      return c.json({ moved: parts, to: parts + families > 0 ? moveTo : null });
    },
  )
  /** Some items by id (?ids=1,2,3), for requesting them. */
  .get("/items", requireAuth, async (c) => {
    const ids = (c.req.query("ids") ?? "")
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 100);
    if (ids.length === 0) return c.json([]);
    const db = createOrdersDb(c.env.ORDERS_DB);
    const rows = await db
      .select(itemColumns)
      .from(catalogItems)
      .where(inArray(catalogItems.id, ids));
    return c.json(rows.map(parsed));
  })
  .post("/items", requireAuth, requireCatalogEditor, itemValidator(false), async (c) => {
    const body = c.req.valid("json") as ItemFields;
    const db = createOrdersDb(c.env.ORDERS_DB);
    if (!(await categoryNames(db)).includes(body.category)) return c.json(NO_CATEGORY, 400);
    const now = Date.now();
    const user = c.get("userDisplayName");
    const row = await db
      .insert(catalogItems)
      .values({
        ...body,
        options: JSON.stringify(body.options ?? {}),
        ...linkFields(body.url),
        source: "request",
        createdBy: user,
        createdAt: now,
        updatedBy: user,
        updatedAt: now,
      })
      .returning(itemColumns)
      .get();
    return c.json(parsed(row), 201);
  })
  .patch("/items/:id", requireAuth, requireCatalogEditor, itemValidator(true), async (c) => {
    const id = Number(c.req.param("id"));
    const { options, ...body } = c.req.valid("json");
    if (Object.keys(body).length === 0 && options === undefined) {
      return c.json({ error: "Nothing to update." }, 400);
    }
    const db = createOrdersDb(c.env.ORDERS_DB);
    if (body.category !== undefined && !(await categoryNames(db)).includes(body.category)) {
      return c.json(NO_CATEGORY, 400);
    }
    const row = await db
      .update(catalogItems)
      .set({
        ...body,
        ...(options !== undefined ? { options: JSON.stringify(options) } : {}),
        // A new link may be a different option: drop the store ids that came with the old one.
        ...(body.url !== undefined
          ? { ...linkFields(body.url), storePlatform: null, storeVariantId: null }
          : {}),
        updatedBy: c.get("userDisplayName"),
        updatedAt: Date.now(),
      })
      .where(eq(catalogItems.id, id))
      .returning(itemColumns)
      .get();
    if (!row) return c.json({ error: "Catalog part not found." }, 404);
    return c.json(parsed(row));
  })
  /** Deleting an item keeps the requests for it (they just stop pointing at the catalog). */
  .delete("/items/:id", requireAuth, requireCatalogEditor, async (c) => {
    const id = Number(c.req.param("id"));
    const db = createOrdersDb(c.env.ORDERS_DB);
    const [, deleted] = await db.batch([
      db
        .update(orderRequests)
        .set({ catalogItemId: null })
        .where(eq(orderRequests.catalogItemId, id)),
      db.delete(catalogItems).where(eq(catalogItems.id, id)).returning({ id: catalogItems.id }),
    ]);
    if (deleted.length === 0) return c.json({ error: "Catalog part not found." }, 404);
    return c.json({ ok: true });
  });
