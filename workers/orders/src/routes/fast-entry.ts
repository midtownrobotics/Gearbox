import {
  changedFields,
  inTeam,
  logTeamChange,
  requireAuth,
  requireMentor,
  settingLabels,
  withTeam,
} from "@g3/auth";
import { desc, eq, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createOrdersDb } from "../db";
import {
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
import { guessPackQuantity } from "../lib/pack-quantity";
import { type TeamSettings, saveTeamSettings, teamSettings } from "../lib/settings";
import { catalogReady } from "../lib/starter";
import { vendorKey, vendorName } from "../lib/vendors";
import { manifest } from "../manifest";
import type { AppEnv } from "../types";

/** Whether this runtime can format money in a currency ("USD", "CAD", ...). */
function isCurrency(code: string) {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/** Any of the settings; the ones left out stay as they are. */
const settingsValidator = validator("json", (value, c): Partial<TeamSettings> => {
  const v = (value ?? {}) as Record<string, unknown>;
  const fail = (error: string) => c.json({ error }, 400) as never;
  const out: Partial<TeamSettings> = {};
  if (v.namingTemplate !== undefined) {
    const t = v.namingTemplate;
    if (typeof t !== "string" || !t.includes("{title}") || t.length > 200) {
      return fail("The naming template must include {title} (up to 200 characters).");
    }
    out.namingTemplate = t.trim();
  }
  if (v.inventoryRequired !== undefined) {
    if (typeof v.inventoryRequired !== "boolean") {
      return fail("inventoryRequired must be true or false.");
    }
    out.inventoryRequired = v.inventoryRequired;
  }
  if (v.currency !== undefined) {
    if (typeof v.currency !== "string" || !isCurrency(v.currency.trim().toUpperCase())) {
      return fail("currency must be a 3-letter currency code like USD.");
    }
    out.currency = v.currency.trim().toUpperCase();
  }
  if (v.fiscalYearStart !== undefined) {
    const month = v.fiscalYearStart;
    if (!Number.isInteger(month) || (month as number) < 1 || (month as number) > 12) {
      return fail("fiscalYearStart must be a month from 1 to 12.");
    }
    out.fiscalYearStart = month as number;
  }
  if (Object.keys(out).length === 0) return fail("Nothing to change.");
  return out;
});

/**
 * The team's settings: everyone reads them (pages need the currency and calendar); mentors change
 * them. Budgets and spending follow a new fiscal-year start right away, since they're
 * worked out from when orders were placed.
 */
export const settingsRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    return c.json({
      ...(await teamSettings(db, c.get("teamId"))),
      defaultNamingTemplate: DEFAULT_TEMPLATE,
    });
  })
  .put("/", requireMentor, settingsValidator, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const teamId = c.get("teamId");
    const input = c.req.valid("json");
    const before = await teamSettings(db, teamId);
    await saveTeamSettings(db, teamId, input);
    const changed = changedFields(before, input);
    if (changed.length > 0) {
      await logTeamChange(c.env, teamId, {
        userId: c.get("userId"),
        app: "orders",
        what: "Orders settings",
        changed: settingLabels(manifest, changed),
      });
    }
    return c.json({
      ...(await teamSettings(db, teamId)),
      defaultNamingTemplate: DEFAULT_TEMPLATE,
    });
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
    return c.json(
      await db
        .select()
        .from(categoryRules)
        .where(inTeam(categoryRules, c.get("teamId")))
        .orderBy(categoryRules.keyword)
        .all(),
    );
  })
  .post("/", requireMentor, ruleValidator, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const teamId = c.get("teamId");
    const body = c.req.valid("json");
    const category = await db
      .select({ id: budgetCategories.id })
      .from(budgetCategories)
      .where(inTeam(budgetCategories, teamId, eq(budgetCategories.id, body.categoryId)))
      .get();
    if (!category) return c.json({ error: "Pick a budget category." }, 400);
    const row = await db
      .insert(categoryRules)
      .values(withTeam(teamId, { ...body, createdAt: Date.now() }))
      .returning()
      .get();
    return c.json(row, 201);
  })
  .delete("/:id", requireMentor, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const row = await db
      .delete(categoryRules)
      .where(
        inTeam(categoryRules, c.get("teamId"), eq(categoryRules.id, Number(c.req.param("id")))),
      )
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
  catalogReady,
  suggestValidator,
  async (c) => {
    const input = c.req.valid("json");
    const db = createOrdersDb(c.env.ORDERS_DB);
    const teamId = c.get("teamId");
    const [settings, categories, rules, profile, past] = await Promise.all([
      teamSettings(db, teamId),
      db
        .select({
          id: budgetCategories.id,
          name: budgetCategories.name,
          isArchived: budgetCategories.isArchived,
        })
        .from(budgetCategories)
        .where(inTeam(budgetCategories, teamId))
        .all(),
      db
        .select()
        .from(categoryRules)
        .where(inTeam(categoryRules, teamId))
        .orderBy(categoryRules.id)
        .all(),
      db
        .select()
        .from(vendors)
        .where(inTeam(vendors, teamId, eq(vendors.key, vendorKey(input.vendor))))
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
        // The wishlist was never requested: it isn't "bought before" or a category's history.
        .where(inTeam(orderRequests, teamId, ne(orderRequests.status, "wishlist")))
        .orderBy(desc(orderRequests.createdAt))
        .all(),
    ]);

    const key = productKey(input.url);
    // The catalog's category for this product (any of its options), so the requester doesn't
    // have to pick one for a part the catalog already knows.
    // An option's key is the product's with "?variant=<id>" after it. Compared by prefix, not with
    // LIKE: D1 refuses LIKE patterns over 50 bytes, which a product link easily is.
    const optionPrefix = `${key}?variant=`;
    const inCatalog = key
      ? await db
          .select({ category: catalogItems.category, packQuantity: catalogItems.packQuantity })
          .from(catalogItems)
          .where(
            inTeam(
              catalogItems,
              teamId,
              or(
                eq(catalogItems.productKey, key),
                sql`substr(${catalogItems.productKey}, 1, ${optionPrefix.length}) = ${optionPrefix}`,
              ),
            ),
          )
          // The product itself before one of its options.
          .orderBy(sql`${catalogItems.productKey} = ${key} desc`)
          .get()
      : undefined;
    // A part new to the catalog gets a category guessed from its name; the requester checks it.
    const catalogCategoryGuess = inCatalog
      ? null
      : guessCatalogCategory(
          input.title,
          (
            await db
              .select({ name: catalogCategories.name })
              .from(catalogCategories)
              .where(inTeam(catalogCategories, teamId))
              .all()
          ).map((r) => r.name),
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

    // How many parts one unit is: the catalog's, for a product it knows as a pack; else what the
    // product's name says ("PK4", "10 pack"), which the requester checks.
    const packQuantity = inCatalog && inCatalog.packQuantity > 1 ? inCatalog.packQuantity : null;
    const packQuantityGuess =
      packQuantity === null ? guessPackQuantity(`${input.title} ${input.variant ?? ""}`) : null;

    return c.json({
      catalogCategory: inCatalog?.category ?? null,
      catalogCategoryGuess,
      packQuantity,
      packQuantityGuess,
      name: applyTemplate(settings.namingTemplate, input),
      vendor: input.vendor,
      category,
      history: history.map(({ categoryId, url, sku: _sku, vendor: _vendor, ...h }) => ({
        ...h,
        categoryName: categories.find((cat) => cat.id === categoryId)?.name ?? null,
      })),
    });
  },
);
