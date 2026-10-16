import { catalogKey, productKey } from "@g3/worker-orders/product-key";
import type { CatalogItem } from "../../shared/types";

/** Whether the search box holds a link rather than words to search for. */
export const isLink = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

/**
 * The catalog part a pasted link is, matched the way the worker matches a requested link
 * (lib/product-key.ts): the same product and option, else the same product page when only one
 * part has it, else the same saved link (a search or homepage link). Null when it isn't in the
 * catalog.
 */
export function findByLink(items: CatalogItem[], raw: string): CatalogItem | null {
  const key = productKey(raw.trim());
  if (!key) return null;
  const products = items.filter((i) => i.linkKind === "product");
  const exact = products.find((i) => catalogKey(i.url, i.storeVariantId) === key);
  if (exact) return exact;
  const base = key.replace(/\?variant=.*$/, "");
  const samePage = products.filter((i) => productKey(i.url) === base);
  if (samePage.length === 1) return samePage[0];
  return items.find((i) => productKey(i.url) === key) ?? null;
}
