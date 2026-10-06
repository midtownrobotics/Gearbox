import { eq, sql } from "drizzle-orm";
import type { OrdersDb } from "../db";
import { type LinkKind, catalogCategories, catalogItems } from "../db/schema";

/** A price paid more than this long ago may have changed: look it up again. */
export const PRICE_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/** The part of a product URL that identifies it: host + path, or an Amazon ASIN. */
export function productKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const asin = url.pathname.match(
      /\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i,
    )?.[1];
    if (asin && /(^|\.)amazon\./.test(host)) return `amazon:${asin.toUpperCase()}`;
    const variant = url.searchParams.get("variant");
    return `${host}${url.pathname.replace(/\/+$/, "").toLowerCase()}${variant ? `?variant=${variant}` : ""}`;
  } catch {
    return null;
  }
}

/** The catalog's key for one buyable thing: the product link plus the chosen store option. */
export function catalogKey(url: string, storeVariantId: string | null): string | null {
  const key = productKey(url);
  if (!key || !storeVariantId || key.includes("?variant=") || key.startsWith("amazon:")) {
    return key;
  }
  return `${key}?variant=${storeVariantId}`;
}

/** Whether a link is a product page, a vendor search, or just the vendor's homepage. */
export function linkKindOf(raw: string): LinkKind {
  try {
    const url = new URL(raw);
    if (url.pathname.replace(/\/+$/, "") === "" && !url.search) return "homepage";
    if (
      /search/i.test(url.pathname) ||
      ["q", "query", "search", "search_query", "keyword"].some((p) => url.searchParams.has(p))
    ) {
      return "search";
    }
    return "product";
  } catch {
    return "product";
  }
}

/** A Shopify option's own link (`?variant=`), so opening or looking it up lands on that option. */
export function catalogUrl(url: string, platform: string | null, variantId: string | null) {
  if (platform !== "shopify" || !variantId) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("variant")) u.searchParams.set("variant", variantId);
    return u.toString();
  } catch {
    return url;
  }
}

/** What a request says about its catalog item. */
export type CatalogChoice = {
  /** Picked from the catalog. */
  catalogItemId?: number | null;
  /** For a link the catalog doesn't have yet: where it goes. Required then. */
  catalogCategory?: string | null;
  /** The part's own name for the catalog (the request title follows the team template). */
  catalogName?: string | null;
};

type RequestItem = {
  url: string;
  vendor: string;
  title: string;
  sku: string | null;
  variant: string | null;
  image: string | null;
  storePlatform: string | null;
  storeVariantId: string | null;
};

/**
 * The catalog item a submitted request is: the one picked from the catalog, or the one with the
 * same link, or a new one in the category the requester chose. A picked item that only had a
 * search or homepage link takes the requester's product link. Returns null when the link is new
 * and no category was given (the caller rejects the request).
 */
export async function catalogItemFor(
  db: OrdersDb,
  choice: CatalogChoice,
  item: RequestItem,
  userName: string,
): Promise<number | null> {
  const now = Date.now();
  const key = catalogKey(item.url, item.storeVariantId);
  const kind = linkKindOf(item.url);

  if (choice.catalogItemId) {
    const picked = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.id, choice.catalogItemId))
      .get();
    if (picked) {
      const better = picked.linkKind !== "product" && kind === "product";
      await db
        .update(catalogItems)
        .set({
          requestCount: sql`${catalogItems.requestCount} + 1`,
          lastRequestedAt: now,
          ...(better
            ? {
                url: catalogUrl(item.url, item.storePlatform, item.storeVariantId),
                linkKind: "product" as const,
                productKey: key,
                storePlatform: item.storePlatform,
                storeVariantId: item.storeVariantId,
                updatedBy: userName,
                updatedAt: now,
              }
            : {}),
          ...(picked.image ? {} : { image: item.image }),
        })
        .where(eq(catalogItems.id, picked.id));
      return picked.id;
    }
  }

  if (key && kind === "product") {
    const same = await db
      .select({ id: catalogItems.id, image: catalogItems.image })
      .from(catalogItems)
      .where(eq(catalogItems.productKey, key))
      .get();
    if (same) {
      await db
        .update(catalogItems)
        .set({
          requestCount: sql`${catalogItems.requestCount} + 1`,
          lastRequestedAt: now,
          ...(same.image ? {} : { image: item.image }),
        })
        .where(eq(catalogItems.id, same.id));
      return same.id;
    }
  }

  // A new part goes in one of the catalog's categories (only editors make new ones).
  const category = choice.catalogCategory?.trim();
  if (!category) return null;
  const known = await db
    .select({ name: catalogCategories.name })
    .from(catalogCategories)
    .where(eq(catalogCategories.name, category))
    .get();
  if (!known) return null;
  const name =
    choice.catalogName?.trim() || (item.variant ? `${item.title} (${item.variant})` : item.title);
  const created = await db
    .insert(catalogItems)
    .values({
      category,
      name: name.slice(0, 300),
      vendor: item.vendor,
      sku: item.sku,
      options: JSON.stringify(item.variant ? { Option: item.variant } : {}),
      url: catalogUrl(item.url, item.storePlatform, item.storeVariantId),
      linkKind: kind,
      productKey: kind === "product" ? key : null,
      image: item.image,
      storePlatform: item.storePlatform,
      storeVariantId: item.storeVariantId,
      source: "request",
      requestCount: 1,
      lastRequestedAt: now,
      createdBy: userName,
      createdAt: now,
      updatedBy: userName,
      updatedAt: now,
    })
    .returning({ id: catalogItems.id })
    .get();
  return created.id;
}

/** Placed lines set their catalog item's price (what we actually paid, and when). */
export async function recordPrices(
  db: OrdersDb,
  lines: { catalogItemId: number | null; unitPriceCents: number | null }[],
  at: number,
) {
  for (const line of lines) {
    if (!line.catalogItemId || line.unitPriceCents === null) continue;
    await db
      .update(catalogItems)
      .set({ priceCents: line.unitPriceCents, priceAt: at })
      .where(eq(catalogItems.id, line.catalogItemId));
  }
}
