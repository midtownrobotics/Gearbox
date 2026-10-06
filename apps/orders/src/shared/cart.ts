// One-click carts for stores that accept them in a link:
// - Shopify stores (WCP, AndyMark, ThriftyBot, SDS, ...): /cart/<variant>:<qty>,<variant>:<qty>
//   loads those items into a fresh cart and opens checkout.
// Amazon goes through Share-A-Cart instead (Amazon's own multi-item link needs an Associates tag);
// McMaster, DigiKey, REV and the rest stay manual.

export type CartLine = {
  url: string;
  sku: string | null;
  storePlatform: string | null;
  storeVariantId: string | null;
  quantity: number;
};

export type CartLink = { label: string; href: string; count: number };

/** The Shopify variant id: saved at request time, or a ?variant= in the product link. */
function shopifyVariant(line: CartLine, url: URL): string | null {
  if (line.storeVariantId && /^\d+$/.test(line.storeVariantId)) {
    return line.storePlatform === "shopify" ? line.storeVariantId : null;
  }
  const fromUrl = url.searchParams.get("variant");
  return fromUrl && /^\d+$/.test(fromUrl) ? fromUrl : null;
}

/** Adds up quantities of the same item (two requests for one product). */
function merge(items: { id: string; qty: number }[]) {
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.id, (merged.get(i.id) ?? 0) + i.qty);
  return [...merged];
}

/**
 * Cart links for the lines that support one, grouped by store, plus how many lines can't be
 * added automatically.
 */
export function cartLinks(lines: CartLine[]): { links: CartLink[]; manual: number } {
  const shopify = new Map<string, { id: string; qty: number }[]>();
  let manual = 0;
  for (const line of lines) {
    let url: URL;
    try {
      url = new URL(line.url);
    } catch {
      manual++;
      continue;
    }
    const variant = shopifyVariant(line, url);
    if (variant) {
      const items = shopify.get(url.origin) ?? [];
      items.push({ id: variant, qty: line.quantity });
      shopify.set(url.origin, items);
    } else manual++;
  }

  const links: CartLink[] = [];
  for (const [origin, items] of shopify) {
    links.push({
      label: shopify.size > 1 ? new URL(origin).hostname.replace(/^www\./, "") : "cart",
      href: `${origin}/cart/${merge(items)
        .map(([id, qty]) => `${id}:${qty}`)
        .join(",")}`,
      count: items.length,
    });
  }
  return { links, manual };
}
