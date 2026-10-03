import { requireAuth, requireMentor } from "@g3/auth";
import { desc, eq, like, or } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type OrdersDb, createOrdersDb } from "../db";
import {
  appSettings,
  budgetCategories,
  catalogCategories,
  catalogItems,
  categoryRules,
  orderRequests,
  vendors,
} from "../db/schema";
import { productKey } from "../lib/catalog";
import { guessCatalogCategory, matchesKeyword } from "../lib/category-guess";
import { DEFAULT_TEMPLATE, applyTemplate } from "../lib/naming";
import { vendorKey, vendorName } from "../lib/vendors";
import type { AppEnv } from "../types";

const TEMPLATE_KEY = "naming_template";

async function namingTemplate(db: OrdersDb) {
  const row = await db.select().from(appSettings).where(eq(appSettings.key, TEMPLATE_KEY)).get();
  return row?.value ?? DEFAULT_TEMPLATE;
}

const settingsValidator = validator("json", (value, c): { namingTemplate: string } => {
  const t = (value as { namingTemplate?: unknown })?.namingTemplate;
  if (typeof t !== "string" || !t.includes("{title}") || t.length > 200) {
    return c.json(
      { error: "The naming template must include {title} (up to 200 characters)." },
      400,
    ) as never;
  }
  return { namingTemplate: t.trim() };
});

export const settingsRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    return c.json({
      namingTemplate: await namingTemplate(db),
      defaultNamingTemplate: DEFAULT_TEMPLATE,
    });
  })
  .put("/", requireMentor, settingsValidator, async (c) => {
    const { namingTemplate: value } = c.req.valid("json");
    const db = createOrdersDb(c.env.ORDERS_DB);
    await db
      .insert(appSettings)
      .values({ key: TEMPLATE_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    return c.json({ namingTemplate: value });
  });

const ruleValidator = validator("json", (value, c): { keyword: string; categoryId: number } => {
  const v = (value ?? {}) as Record<string, unknown>;
  if (typeof v.keyword !== "string" || !v.keyword.trim() || v.keyword.length > 40) {
    return c.json({ error: "keyword must be 1–40 characters." }, 400) as never;
  }
  if (!Number.isInteger(v.categoryId))
    return c.json({ error: "Pick a budget category." }, 400) as never;
  return { keyword: v.keyword.trim().toLowerCase(), categoryId: v.categoryId as number };
});

/** Keyword → category rules for guessing a new request's budget category. */
export const categoryRulesRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    return c.json(await db.select().from(categoryRules).orderBy(categoryRules.keyword).all());
  })
  .post("/", requireMentor, ruleValidator, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const row = await db
      .insert(categoryRules)
      .values({ ...c.req.valid("json"), createdAt: Date.now() })
      .returning()
      .get();
    return c.json(row, 201);
  })
  .delete("/:id", requireMentor, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const row = await db
      .delete(categoryRules)
      .where(eq(categoryRules.id, Number(c.req.param("id"))))
      .returning()
      .get();
    if (!row) return c.json({ error: "Rule not found." }, 404);
    return c.json({ ok: true });
  });

type SuggestInput = {
  url: string;
  vendor: string;
  sku: string | null;
  title: string;
  variant: string | null;
};

const suggestValidator = validator("json", (value, c): SuggestInput => {
  const v = (value ?? {}) as Record<string, unknown>;
  const text = (x: unknown, max: number) =>
    typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null;
  const url = text(v.url, 2000);
  if (!url) return c.json({ error: "url is required." }, 400) as never;
  let vendor = text(v.vendor, 100);
  if (!vendor) {
    try {
      vendor = vendorName(new URL(url).hostname);
    } catch {
      vendor = "";
    }
  }
  return {
    url,
    vendor: vendorName(vendor),
    sku: text(v.sku, 100),
    title: text(v.title, 500) ?? "",
    variant: text(v.variant, 200),
  };
});

/**
 * POST /suggest: for a product being requested, the name the team template gives it, a budget
 * category guess (last purchase of this product → the vendor's default → keyword rules), the
 * catalog category (the catalog's own, or a guess from built-in keywords for a part new to it),
 * and past requests for the same link or SKU.
 */
export const suggestRouter = new Hono<AppEnv>().post(
  "/",
  requireAuth,
  suggestValidator,
  async (c) => {
    const input = c.req.valid("json");
    const db = createOrdersDb(c.env.ORDERS_DB);
    const [template, categories, rules, profile, past] = await Promise.all([
      namingTemplate(db),
      db
        .select({
          id: budgetCategories.id,
          name: budgetCategories.name,
          isArchived: budgetCategories.isArchived,
        })
        .from(budgetCategories)
        .all(),
      db.select().from(categoryRules).orderBy(categoryRules.id).all(),
      db
        .select()
        .from(vendors)
        .where(eq(vendors.key, vendorKey(input.vendor)))
        .get(),
      db
        .select({
          id: orderRequests.id,
          url: orderRequests.url,
          sku: orderRequests.sku,
          vendor: orderRequests.vendor,
          title: orderRequests.title,
          quantity: orderRequests.quantity,
          unitPriceCents: orderRequests.unitPriceCents,
          status: orderRequests.status,
          requesterName: orderRequests.requesterName,
          categoryId: orderRequests.categoryId,
          createdAt: orderRequests.createdAt,
        })
        .from(orderRequests)
        .orderBy(desc(orderRequests.createdAt))
        .all(),
    ]);

    const key = productKey(input.url);
    // The catalog's category for this product (any of its options), so the requester doesn't
    // have to pick one for a part the catalog already knows.
    const inCatalog = key
      ? await db
          .select({ category: catalogItems.category })
          .from(catalogItems)
          .where(
            or(eq(catalogItems.productKey, key), like(catalogItems.productKey, `${key}?variant=%`)),
          )
          .get()
      : undefined;
    // A part new to the catalog gets a category guessed from its name; the requester checks it.
    const catalogCategoryGuess = inCatalog
      ? null
      : guessCatalogCategory(
          input.title,
          (await db.select({ name: catalogCategories.name }).from(catalogCategories).all()).map(
            (r) => r.name,
          ),
        );
    const vendor = vendorKey(input.vendor);
    const sku = input.sku?.toLowerCase();
    const history = past
      .filter(
        (r) =>
          (key !== null && productKey(r.url) === key) ||
          (sku && r.sku?.toLowerCase() === sku && vendorKey(r.vendor) === vendor),
      )
      .slice(0, 10);

    const open = new Map(
      categories.filter((cat) => !cat.isArchived).map((cat) => [cat.id, cat.name]),
    );
    let category: {
      id: number;
      name: string;
      source: "history" | "vendor" | "keyword";
      detail: string | null;
    } | null = null;
    const last = history.find(
      (r) => r.status !== "denied" && r.status !== "cancelled" && open.has(r.categoryId),
    );
    if (last) {
      category = {
        id: last.categoryId,
        name: open.get(last.categoryId) as string,
        source: "history",
        detail: null,
      };
    } else if (profile?.defaultCategoryId && open.has(profile.defaultCategoryId)) {
      category = {
        id: profile.defaultCategoryId,
        name: open.get(profile.defaultCategoryId) as string,
        source: "vendor",
        detail: profile.name,
      };
    } else {
      const rule = rules.find(
        (r) => open.has(r.categoryId) && matchesKeyword(input.title, r.keyword),
      );
      if (rule) {
        category = {
          id: rule.categoryId,
          name: open.get(rule.categoryId) as string,
          source: "keyword",
          detail: rule.keyword,
        };
      }
    }

    return c.json({
      catalogCategory: inCatalog?.category ?? null,
      catalogCategoryGuess,
      name: applyTemplate(template, input),
      vendor: input.vendor,
      category,
      history: history.map(({ categoryId, url, sku: _sku, vendor: _vendor, ...h }) => ({
        ...h,
        categoryName: categories.find((cat) => cat.id === categoryId)?.name ?? null,
      })),
    });
  },
);
