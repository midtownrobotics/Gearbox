import { site } from "@g3/site-config";
import type { PartLookup, PartVariant } from "@g3/worker-edge/lookup-types";
import { vendorSiteOf } from "./vendor-sites";

/**
 * Part lookup straight from the vendor, with no edge box: the sites that answer a worker. Every
 * Shopify store has a public Storefront API (WCP, AndyMark, The Thrifty Bot, CTRE, SDS, ...),
 * and REV, on BigCommerce, publishes a product feed. Other sites (Amazon, McMaster, DigiKey,
 * anything else) are left to the team's edge box (`routes/lookup.ts`). Gives null when the link
 * isn't one of these or the vendor didn't answer, so the box can try.
 *
 * Results match the edge agent's (`devices/edge-agent/src/modules/lookup/part-lookup.ts`), which
 * reads the same stores its own way: variant ids are Shopify's numeric ones (cart links use them),
 * and a WCP placeholder product's dropdowns are read the same way (Itoris, below).
 */

const USER_AGENT = `GearboxPartLookup/1.0 (+https://${site.platformDomain})`;
const TIMEOUT_MS = 10_000;
const MAX_DESCRIPTION = 500;
const SHOPIFY_API_VERSION = "2026-10";
/** REV's feed of every product it sells in the US (from REV, for VendorDiff). */
export const REV_FEED_URL = "https://dashboard.revrobotics.com/feeds/usa/products.json";

export async function lookUpAtVendor(input: URL): Promise<PartLookup | null> {
  const known = vendorSiteOf(input.href);
  try {
    if (known?.platform === "rev") return await lookUpRev(input);
    // A known store's short link (andymark.com/am-0028) redirects to its product page.
    const page = handleOf(input) ? input : known ? await redirectTarget(input) : null;
    const handle = page && handleOf(page);
    if (!page || !handle) return null;
    return await lookUpShopify(input, page.origin, handle);
  } catch {
    return null;
  }
}

function fetchFrom(url: URL | string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** The Shopify product handle in a `/products/<handle>` link. */
function handleOf(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.indexOf("products");
  return index === -1 ? null : (parts[index + 1]?.replace(/\.(json|js)$/, "") ?? null);
}

/** Where a link redirects to (only the redirect is fetched), or null. */
async function redirectTarget(url: URL): Promise<URL | null> {
  const res = await fetchFrom(url, { redirect: "manual" });
  const location = res.headers.get("Location");
  return res.status >= 300 && res.status < 400 && location ? new URL(location, url) : null;
}

const base = (input: URL) => ({
  url: input.toString(),
  vendor: input.hostname.replace(/^www\./, ""),
});

// --- Shopify ---------------------------------------------------------------

const SHOPIFY_QUERY = `query ($handle: String!) {
  product(handle: $handle) {
    id title description
    featuredImage { url }
    variants(first: 250) {
      nodes { id title sku price { amount currencyCode } availableForSale }
    }
  }
}`;

type ShopifyProduct = {
  id: string;
  title: string;
  description: string;
  featuredImage: { url: string } | null;
  variants: {
    nodes: {
      id: string;
      title: string;
      sku: string | null;
      price: { amount: string; currencyCode: string };
      availableForSale: boolean;
    }[];
  };
};

/** "gid://shopify/ProductVariant/123" → "123". */
const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

async function lookUpShopify(input: URL, origin: string, handle: string) {
  const res = await fetchFrom(`${origin}/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ query: SHOPIFY_QUERY, variables: { handle } }),
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    data?: { product: ShopifyProduct | null };
  } | null;
  const product = body?.data?.product;
  const nodes = product?.variants.nodes ?? [];
  if (!product || nodes.length === 0) return null;

  const shared = {
    ...base(input),
    source: "shopify" as const,
    title: product.title,
    description: truncate(product.description),
    image: product.featuredImage?.url,
    currency: nodes[0].price.currencyCode,
  };
  // A product with no options of its own may be a placeholder whose choices are other products,
  // listed by an options app (WCP's type/size dropdowns); those choices are what gets bought.
  const linked =
    nodes.length === 1 && nodes[0].title === "Default Title"
      ? await itorisLinkedProducts(origin, numericId(product.id))
      : [];
  if (linked.length > 0) {
    return withSelectedVariant(
      { ...shared, available: linked.some((v) => v.available !== false), variants: linked },
      input,
    );
  }

  const variants: PartVariant[] = nodes.map((v) => ({
    id: numericId(v.id),
    title: v.title,
    sku: v.sku || undefined,
    price: price(v.price.amount),
    available: v.availableForSale,
  }));
  return withSelectedVariant(
    {
      ...shared,
      sku: variants.length === 1 ? variants[0].sku : undefined,
      price: variants[0].price,
      available: variants.some((v) => v.available !== false),
      variants,
    },
    input,
  );
}

// --- Itoris Dynamic Product Options (a Shopify app WCP uses) ---------------

const ITORIS_URL = "https://node1.itoris.com/dpo/storefront/include.js";

type ItorisOption = {
  title?: string;
  items?: {
    title?: string;
    price?: number;
    /** "<product id>:<variant id>" when the item is a linked product. */
    sku?: string;
    sku_is_product_id_linked?: number;
    product_sku?: string;
    is_salable?: number | null;
  }[];
};

/**
 * The products a placeholder product's option dropdowns stand for, as variants (the linked
 * product's variant id, so cart links work). Empty when the store doesn't use the app, the
 * product has no linked options, or the app's server doesn't answer.
 */
async function itorisLinkedProducts(origin: string, productId: string): Promise<PartVariant[]> {
  try {
    const meta = await fetchFrom(new URL("/meta.json", origin), {
      headers: { Accept: "application/json" },
    });
    const shop = meta.ok
      ? ((await meta.json().catch(() => null)) as { myshopify_domain?: string } | null)
          ?.myshopify_domain
      : undefined;
    if (!shop) return [];

    const endpoint = new URL(ITORIS_URL);
    endpoint.search = new URLSearchParams({ controller: "GetOptionConfig", shop }).toString();
    const res = await fetchFrom(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ product_id: productId }).toString(),
    });
    if (!res.ok) return [];
    const html = await res.text();
    // The options are the second argument of `dpoOptions.initialize({config}, [options])`.
    const call = html.indexOf("dpoOptions.initialize(");
    const start = call === -1 ? -1 : html.indexOf(", [{", call);
    const options = start === -1 ? null : jsonArrayAt<ItorisOption>(html, start + 2);
    if (!options) return [];

    const groups = options.filter((o) => o.items?.some((i) => i.sku_is_product_id_linked));
    return groups.flatMap((group) =>
      (group.items ?? []).flatMap((item) => {
        const variantId = item.sku_is_product_id_linked ? item.sku?.split(":")[1] : undefined;
        if (!variantId || !item.title) return [];
        return [
          {
            id: variantId,
            // Several sections ("New", "Legacy", "Sleeves"): say which one each choice is from.
            title: groups.length > 1 && group.title ? `${group.title}: ${item.title}` : item.title,
            sku: item.product_sku || undefined,
            price: typeof item.price === "number" ? item.price : undefined,
            available: item.is_salable === 0 ? false : item.is_salable === 1 ? true : undefined,
          },
        ];
      }),
    );
  } catch {
    return [];
  }
}

/** Parses the JSON array starting at `text[start]` (which must be "["), ignoring what follows. */
function jsonArrayAt<T>(text: string, start: number): T[] | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T[];
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// --- REV -------------------------------------------------------------------

type RevItem = {
  sku: string;
  name: string;
  availability_status: string;
  price: number;
  url: string;
  image_url: string | null;
};

/** A page's path for matching: REV's addresses aren't case-sensitive. */
const pathKey = (path: string) => path.toLowerCase().replace(/\/+$/, "");

/**
 * A REV product page from REV's feed, where each of a page's options is its own line:
 * "JST PH 4-pin Sensor Cables ((REV-31-1407-PK4) JST PH 4-pin Sensor Cable - 30cm - 4 Pack)".
 * The feed is the same for everyone, so Cloudflare keeps it an hour.
 */
async function lookUpRev(input: URL) {
  const res = await fetchFrom(REV_FEED_URL, {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!res.ok) return null;
  const items = (await res.json().catch(() => null)) as RevItem[] | null;
  const key = pathKey(input.pathname);
  const lines = (items ?? []).filter((item) => {
    try {
      return pathKey(new URL(item.url).pathname) === key;
    } catch {
      return false;
    }
  });
  if (lines.length === 0) return null;

  const option = (item: RevItem) => item.name.match(/^(.*?) \(\((.+?)\) (.+)\)$/);
  const variants: PartVariant[] = lines.map((item) => ({
    id: item.sku,
    title: lines.length > 1 ? (option(item)?.[3] ?? item.name) : "Default Title",
    sku: item.sku,
    price: item.price,
    available: item.availability_status === "Available",
  }));
  const first = lines[0];
  return {
    ...base(input),
    source: "bigcommerce" as const,
    title: lines.length > 1 ? (option(first)?.[1] ?? first.name) : first.name,
    sku: lines.length === 1 ? first.sku : undefined,
    image: first.image_url ?? undefined,
    price: first.price,
    currency: "USD",
    available: variants.some((v) => v.available),
    variants,
  } satisfies PartLookup;
}

// --- Shared ----------------------------------------------------------------

/** The `?variant=` the link chose: the result's part number and price are that option's. */
function withSelectedVariant(result: PartLookup, input: URL): PartLookup {
  const variantId = input.searchParams.get("variant") ?? undefined;
  const selected = variantId ? result.variants.find((v) => v.id === variantId) : undefined;
  if (!selected) return { ...result, selectedVariantId: variantId };
  return {
    ...result,
    selectedVariantId: variantId,
    sku: selected.sku ?? result.sku,
    price: selected.price ?? result.price,
    available: selected.available ?? result.available,
  };
}

function price(amount: string): number | undefined {
  const value = Number(amount);
  return Number.isFinite(value) ? value : undefined;
}

function truncate(value: string | undefined) {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}
