import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { type StockStatus, itemListings, items, stock } from "../db/schema";
import { type FieldValues, parseValues } from "./fields";
import { textField } from "./input";

// Entries as the pages see them: each with where its stock is and how it can be bought.

export type StockView = {
  id: number;
  locationId: number;
  status: StockStatus;
  robotId: number | null;
  subsystemId: number | null;
  quantity: number;
  /** When someone last counted this row, and who. */
  countedAt: number | null;
  countedByName: string | null;
};

export type ListingView = {
  id: number;
  /** The part's id in Orders' catalog, when it's linked to one. */
  catalogItemId: number | null;
  vendor: string;
  sku: string | null;
  name: string;
  url: string | null;
  priceCents: number | null;
  priceAt: number | null;
};

export type ItemView = {
  id: number;
  name: string;
  /** The team's fields: field id -> value. */
  values: FieldValues;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
  stock: StockView[];
  listings: ListingView[];
};

/** Every entry by name, or just one. */
export async function loadItems(db: Db, onlyId?: number): Promise<ItemView[]> {
  const [itemRows, stockRows, listingRows] = await Promise.all([
    db
      .select()
      .from(items)
      .where(onlyId === undefined ? undefined : eq(items.id, onlyId))
      .orderBy(sql`lower(${items.name})`, asc(items.id))
      .all(),
    db
      .select()
      .from(stock)
      .where(onlyId === undefined ? undefined : eq(stock.itemId, onlyId))
      // Storage before in use, then oldest first.
      .orderBy(sql`${stock.status} = 'in_use'`, asc(stock.id))
      .all(),
    db
      .select()
      .from(itemListings)
      .where(onlyId === undefined ? undefined : eq(itemListings.itemId, onlyId))
      .orderBy(asc(itemListings.id))
      .all(),
  ]);

  const views = new Map<number, ItemView>();
  for (const row of itemRows) {
    views.set(row.id, {
      id: row.id,
      name: row.name,
      values: parseValues(row.fieldValues),
      createdByName: row.createdByName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      stock: [],
      listings: [],
    });
  }
  for (const row of stockRows) {
    views.get(row.itemId)?.stock.push({
      id: row.id,
      locationId: row.locationId,
      status: row.status,
      robotId: row.robotId,
      subsystemId: row.subsystemId,
      quantity: row.quantity,
      countedAt: row.countedAt,
      countedByName: row.countedByName,
    });
  }
  for (const row of listingRows) {
    views.get(row.itemId)?.listings.push({
      id: row.id,
      catalogItemId: row.catalogItemId,
      vendor: row.vendor,
      sku: row.sku,
      name: row.name,
      url: row.url,
      priceCents: row.priceCents,
      priceAt: row.priceAt,
    });
  }
  return [...views.values()];
}

export type ListingInput = Omit<ListingView, "id">;

const optionalInt = (value: unknown, max: number): number | null | undefined => {
  if (value === null || value === undefined) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : undefined;
};

/** A link people can open, or null. */
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A listing from a request body, or what's wrong with it. */
export function parseListing(raw: unknown): ListingInput | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "listing must be an object." };
  }
  const v = raw as Record<string, unknown>;
  const vendor = textField(v.vendor ?? "", 100);
  const sku = textField(v.sku ?? "", 100);
  const name = textField(v.name ?? "", 300);
  if (vendor === null || sku === null || name === null) {
    return { error: "A listing's vendor, part number or name is too long." };
  }
  const hasUrl = typeof v.url === "string" && v.url.trim() !== "";
  const url = hasUrl ? cleanUrl(v.url) : null;
  if (hasUrl && !url) return { error: "A listing's link must start with https://." };
  const catalogItemId = optionalInt(v.catalogItemId, Number.MAX_SAFE_INTEGER);
  const priceCents = optionalInt(v.priceCents, 100_000_000);
  const priceAt = optionalInt(v.priceAt, Number.MAX_SAFE_INTEGER);
  if (catalogItemId === undefined || priceCents === undefined || priceAt === undefined) {
    return { error: "A listing's catalog part or price isn't a number." };
  }
  if (!vendor && !url) return { error: "A listing needs a vendor or a link." };
  return {
    catalogItemId: catalogItemId || null,
    vendor,
    sku: sku || null,
    name,
    url,
    priceCents,
    priceAt: priceCents === null ? null : priceAt,
  };
}

/** "WCP WCP-0123", "REV", or the link's site: what to call a listing in a sentence. */
export function listingLabel(listing: Pick<ListingView, "vendor" | "sku" | "url">): string {
  const label = [listing.vendor, listing.sku].filter(Boolean).join(" ");
  if (label) return label;
  try {
    return listing.url ? new URL(listing.url).hostname.replace(/^www\./, "") : "a listing";
  } catch {
    return "a listing";
  }
}
