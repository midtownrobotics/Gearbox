import { apiPath, appUrl } from "@g3/site-config";
import { appOn, useAppOn } from "@g3/ui";
import type { ListingView } from "@g3/worker-inventory";
import { useEffect, useState } from "react";

// Orders' parts catalog, read through Orders' own API (the same address for every team's page).
// Inventory works without it: a listing keeps its own copy of the vendor, part number, link and
// price, and the catalog only adds what's newer. While the team has Orders switched off, nothing
// of it shows: no catalog search, no Request buttons, no links to requests (`useOrdersOn`).

export type CatalogPart = {
  id: number;
  name: string;
  vendor: string;
  sku: string | null;
  url: string;
  linkKind: "product" | "search" | "homepage";
  /** What one unit cost last time, as Orders buys it: a whole pack, when it's a pack. */
  priceCents: number | null;
  priceAt: number | null;
  /** How many parts one unit is: 4 for a pack of 4. */
  packQuantity?: number;
};

/** How many parts one unit of a catalog part is. */
export const packOf = (part: Pick<CatalogPart, "packQuantity">) =>
  Math.max(1, part.packQuantity ?? 1);

/**
 * What one part cost. Inventory counts parts, so its prices are per part: a pack of 4 bought for
 * $17.50 is $4.38 each.
 */
export const partPriceCents = (part: Pick<CatalogPart, "priceCents" | "packQuantity">) =>
  part.priceCents === null ? null : Math.round(part.priceCents / packOf(part));

let loading: Promise<CatalogPart[] | null> | null = null;

/** The catalog's parts, or null if Orders is off or can't be reached. Loaded once per page load. */
function loadCatalog(): Promise<CatalogPart[] | null> {
  loading ??= appOn("orders").then((on) =>
    on
      ? fetch(`${apiPath("orders")}/catalog`, { credentials: "include" })
          .then(async (res) =>
            res.ok ? ((await res.json()) as { items: CatalogPart[] }).items : null,
          )
          .catch(() => null)
      : null,
  );
  return loading;
}

/** Whether the team has Orders on: catalog sections and links to Orders show unless it's off. */
export const useOrdersOn = () => useAppOn("orders") !== false;

/** `undefined` while loading, `null` when Orders can't be reached. */
export function useCatalog(): CatalogPart[] | null | undefined {
  const [parts, setParts] = useState<CatalogPart[] | null | undefined>(undefined);
  useEffect(() => {
    let canceled = false;
    void loadCatalog().then((loaded) => {
      if (!canceled) setParts(loaded);
    });
    return () => {
      canceled = true;
    };
  }, []);
  return parts;
}

const same = (a: string | null, b: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The catalog part a listing is: the one it's linked to, else the same vendor and part number,
 * else the same link.
 */
export function catalogPartFor(
  listing: Pick<ListingView, "catalogItemId" | "vendor" | "sku" | "url">,
  parts: CatalogPart[] | null | undefined,
): CatalogPart | null {
  if (!parts) return null;
  return (
    (listing.catalogItemId !== null && parts.find((p) => p.id === listing.catalogItemId)) ||
    parts.find((p) => same(p.vendor, listing.vendor) && same(p.sku, listing.sku)) ||
    parts.find((p) => p.linkKind === "product" && same(p.url, listing.url)) ||
    null
  );
}

/** Parts whose name, vendor or part number has every word typed, best 20. */
export function searchCatalog(parts: CatalogPart[], query: string): CatalogPart[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: CatalogPart[] = [];
  for (const part of parts) {
    const text = `${part.name} ${part.vendor} ${part.sku ?? ""}`.toLowerCase();
    if (words.every((word) => text.includes(word))) {
      out.push(part);
      if (out.length === 20) break;
    }
  }
  return out;
}

/** Orders' New Request page, started from a catalog part. */
export const requestUrl = (part: CatalogPart) => `${appUrl("orders")}/new?catalog=${part.id}`;

export const LINK_LABEL = {
  product: "Product page ↗",
  search: "Vendor search ↗",
  homepage: "Vendor site ↗",
} as const;
