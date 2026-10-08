// How a product link is matched to the catalog. No imports: the Orders pages use it too, through
// @g3/worker-orders/product-key (the catalog page's omnibox matches a pasted link this way).

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
