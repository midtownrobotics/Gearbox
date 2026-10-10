/**
 * Turns a vendor product URL into part details (title, SKU, price, variants).
 *
 * Runs on the edge box (the agent's lookup module), so vendors see the shop's
 * connection rather than a cloud IP. Amazon links (including a.co / amzn.to
 * share links) go straight to Amazon's page markup, fetched with the requester's
 * own browser headers (a desktop browser's when the requester is on a phone). DigiKey blocks scraping, so it uses its official API when
 * credentials are configured. McMaster blocks scraping too and only offers its
 * API to B2B customers, so its lookups return the part number from the URL (plus
 * the name when the page is prerendered). Everything else is tried in order,
 * most reliable first:
 *   1. Shopify: `/products/<handle>.json` (WCP, AndyMark, ThriftyBot, ...), plus the
 *      linked products of Itoris "Dynamic Product Options" when a product is just a
 *      placeholder for them (WCP's tube plugs, etc.)
 *   2. BigCommerce: storefront GraphQL, using the token every page embeds (REV)
 *   3. JSON-LD `Product` blocks in the page
 *   4. Open Graph / product meta tags
 *
 * The platform is detected from the response rather than a vendor list, so new
 * stores work without configuration.
 */

import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from "node:zlib";
import { site } from "@g3/site-config";
import type { ClientHeaders, PartLookup, PartVariant } from "@g3/worker-edge/lookup-types";

export type { PartLookup };

/** Bytes sent and received over the network: wire sizes (compressed), headers included. */
type ByteMeter = (downloaded: number, uploaded: number) => void;
let meter: ByteMeter | null = null;

/** Reports every lookup's network traffic to `fn` (the agent's data-usage accounting). */
export function meterLookups(fn: ByteMeter | null) {
  meter = fn;
}

const headerBytes = (headers: Headers) => {
  let n = 0;
  headers.forEach((value, key) => {
    n += key.length + value.length + 4; // "key: value\r\n"
  });
  return n;
};

function decodeBody(raw: Uint8Array, encoding: string | null): Uint8Array {
  switch (encoding?.trim().toLowerCase()) {
    case undefined:
    case "":
    case "identity":
      return raw;
    case "gzip":
    case "x-gzip":
      return gunzipSync(raw);
    case "br":
      return brotliDecompressSync(raw);
    case "deflate":
      // "deflate" is meant to be zlib-wrapped, but some servers send raw deflate.
      try {
        return inflateSync(raw);
      } catch {
        return inflateRawSync(raw);
      }
    default:
      throw new LookupError(`Vendor site sent an unsupported encoding (${encoding}).`, 502);
  }
}

/**
 * fetch that measures what actually crosses the shop's hotspot: it asks for the raw
 * (still compressed) body, counts it with the headers, then decompresses it here.
 */
async function meteredFetch(input: URL | string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers as Record<string, string> | undefined);
  headers.set("Accept-Encoding", "gzip, deflate, br");
  const res = await fetch(input, { ...init, headers, decompress: false } as RequestInit);
  const raw = new Uint8Array(await res.arrayBuffer());
  const body = typeof init.body === "string" ? new TextEncoder().encode(init.body).length : 0;
  const requestLine = (init.method ?? "GET").length + String(input).length + 12;
  meter?.(
    raw.byteLength + headerBytes(res.headers) + 20,
    requestLine + headerBytes(headers) + body,
  );

  const decoded = decodeBody(raw, res.headers.get("content-encoding"));
  const outHeaders = new Headers(res.headers);
  outHeaders.delete("content-encoding");
  outHeaders.delete("content-length");
  const noBody = res.status === 204 || res.status === 304 || res.status < 200;
  return new Response(noBody ? null : decoded, {
    status: res.status,
    statusText: res.statusText,
    headers: outHeaders,
  });
}

export class LookupError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 502,
  ) {
    super(message);
  }
}

// Shopify rate-limits requests that claim to be Chrome but don't act like it
// (429), so only Amazon (which blocks non-browser agents) gets browser headers:
// the requester's own, falling back to a generic Chrome.
const HONEST_UA = `${site.team.name.replace(/\s+/g, "")}PartLookup/0.1 (+https://${site.domain})`;
const FALLBACK_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const FALLBACK_LANGUAGE = "en-US,en;q=0.9";
const TIMEOUT_MS = 10_000;
const MAX_DESCRIPTION = 500;

export type LookupOptions = {
  /** DigiKey API app ("Product Information V4" at developer.digikey.com); optional. */
  digikey?: { clientId: string; clientSecret: string };
  /** The requester's browser headers, for fetches that must look like a browser. */
  client?: ClientHeaders;
};

/** Headers for a fetch that has to look like a browser: the requester's own when we have them. */
function browserHeaders(client: ClientHeaders = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": client.userAgent || FALLBACK_BROWSER_UA,
    "Accept-Language": client.acceptLanguage || FALLBACK_LANGUAGE,
  };
  if (client.secChUa) headers["Sec-CH-UA"] = client.secChUa;
  if (client.secChUaMobile) headers["Sec-CH-UA-Mobile"] = client.secChUaMobile;
  if (client.secChUaPlatform) headers["Sec-CH-UA-Platform"] = client.secChUaPlatform;
  return headers;
}

/** A phone or tablet browser: its own headers or its user agent say so. */
function isMobileClient(client: ClientHeaders): boolean {
  if (client.secChUaMobile === "?1") return true;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(client.userAgent ?? "");
}

/**
 * Headers for Amazon: always a desktop browser. A phone's headers get Amazon's mobile page, which
 * doesn't have the product details where the desktop page does.
 */
function amazonHeaders(client: ClientHeaders = {}): Record<string, string> {
  if (!isMobileClient(client)) return browserHeaders(client);
  return {
    "User-Agent": FALLBACK_BROWSER_UA,
    "Accept-Language": client.acceptLanguage || FALLBACK_LANGUAGE,
  };
}

export async function lookupPart(rawUrl: string, options: LookupOptions = {}): Promise<PartLookup> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LookupError("Not a valid URL.", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new LookupError("Only http(s) URLs are supported.", 400);
  }

  if (AMAZON_SHORT_HOSTS.has(url.hostname) || isAmazonHost(url.hostname)) {
    return lookupAmazon(url, options.client);
  }
  if (/(^|\.)mcmaster\.com$/.test(url.hostname)) return lookupMcMaster(url);
  if (/(^|\.)digikey\.[a-z.]+$/.test(url.hostname)) return lookupDigiKey(url, options.digikey);

  const variantId = url.searchParams.get("variant") ?? undefined;
  const base = { url: url.toString(), vendor: url.hostname.replace(/^www\./, "") };

  const shopify = await tryShopify(url);
  if (shopify) return withSelectedVariant({ ...base, ...shopify }, variantId);

  const html = await getHtml(url, {
    "User-Agent": HONEST_UA,
    "Accept-Language": options.client?.acceptLanguage || FALLBACK_LANGUAGE,
  });
  const page = await scanPage(html);

  const bigCommerce = await tryBigCommerce(url, html, page);
  if (bigCommerce) return withSelectedVariant({ ...base, ...bigCommerce }, variantId);

  const jsonLd = fromJsonLd(page);
  if (jsonLd) return withSelectedVariant({ ...base, ...jsonLd }, variantId);

  const meta = page.meta;
  const title = meta["og:title"] ?? meta["twitter:title"] ?? page.title ?? page.h1 ?? url.hostname;
  return withSelectedVariant(
    {
      ...base,
      source: "meta",
      title,
      description: truncate(meta["og:description"] ?? meta.description),
      image: meta["og:image"] ?? meta["twitter:image"],
      price: parsePrice(
        meta["product:price:amount"] ?? meta["og:price:amount"] ?? page.itemprop.price,
      ),
      currency:
        meta["product:price:currency"] ?? meta["og:price:currency"] ?? page.itemprop.priceCurrency,
      variants: [],
    },
    variantId,
  );
}

// --- Shopify ---------------------------------------------------------------

type ShopifyProduct = {
  id: number;
  title: string;
  body_html?: string;
  image?: { src: string } | null;
  images?: { src: string }[];
  variants: {
    id: number;
    title: string;
    sku?: string;
    price?: string;
    price_currency?: string;
    available?: boolean;
  }[];
};

async function tryShopify(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.indexOf("products");
  const handle = index === -1 ? undefined : parts[index + 1];
  if (!handle) return null;

  const jsonUrl = new URL(`/products/${handle.replace(/\.(json|js)$/, "")}.json`, url.origin);
  const res = await get(jsonUrl, { "User-Agent": HONEST_UA, Accept: "application/json" });
  if (res.status === 429)
    throw new LookupError("Vendor site is rate limiting us; try again shortly.", 502);
  if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;

  const body = (await res.json().catch(() => null)) as { product?: ShopifyProduct } | null;
  const product = body?.product;
  if (!product?.variants?.length) return null;

  // A product with no options of its own may be a placeholder whose choices are other products,
  // listed by an options app (WCP's type/size dropdowns); those choices are what gets bought.
  const linked =
    product.variants.length === 1 && product.variants[0].title === "Default Title"
      ? await itorisLinkedProducts(url.origin, product.id)
      : [];
  if (linked.length > 0) {
    return {
      source: "shopify" as const,
      title: product.title,
      description: truncate(stripHtml(product.body_html)),
      image: product.image?.src ?? product.images?.[0]?.src,
      currency: product.variants[0].price_currency || undefined,
      available: linked.some((v) => v.available !== false),
      variants: linked,
    };
  }

  const variants: PartVariant[] = product.variants.map((v) => ({
    id: String(v.id),
    title: v.title,
    sku: v.sku || undefined,
    price: parsePrice(v.price),
    available: v.available,
  }));
  const first = variants[0];
  return {
    source: "shopify" as const,
    title: product.title,
    sku: variants.length === 1 ? first.sku : undefined,
    description: truncate(stripHtml(product.body_html)),
    image: product.image?.src ?? product.images?.[0]?.src,
    price: first.price,
    currency: product.variants[0].price_currency || undefined,
    available: variants.some((v) => v.available !== false),
    variants,
  };
}

// --- Itoris Dynamic Product Options (Shopify app) ---------------------------

const ITORIS_URL = "https://node1.itoris.com/dpo/storefront/include.js";

/** Store origin → its *.myshopify.com name, or null when the store doesn't use the app. */
const itorisShops = new Map<string, string | null>();

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
 * product's variant id, so cart links work). Empty when the store doesn't use the app or the
 * product has no linked options.
 */
async function itorisLinkedProducts(origin: string, productId: number): Promise<PartVariant[]> {
  let shop = itorisShops.get(origin);
  if (shop === undefined) {
    const res = await get(new URL("/meta.json", origin), {
      "User-Agent": HONEST_UA,
      Accept: "application/json",
    });
    const meta = res.ok
      ? ((await res.json().catch(() => null)) as { myshopify_domain?: string } | null)
      : null;
    shop = meta?.myshopify_domain ?? null;
    itorisShops.set(origin, shop);
  }
  if (!shop) return [];

  const endpoint = new URL(ITORIS_URL);
  endpoint.search = new URLSearchParams({ controller: "GetOptionConfig", shop }).toString();
  let html: string;
  try {
    const res = await meteredFetch(endpoint, {
      method: "POST",
      headers: {
        "User-Agent": HONEST_UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ product_id: String(productId) }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return []; // The app's server being down shouldn't fail the lookup.
  }
  if (html.includes("Service not registered")) {
    itorisShops.set(origin, null);
    return [];
  }

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

// --- BigCommerce -----------------------------------------------------------

const BIGCOMMERCE_QUERY = `query ($id: Int!) {
  site {
    product(entityId: $id) {
      name
      sku
      plainTextDescription(characterLimit: ${MAX_DESCRIPTION})
      defaultImage { url(width: 800) }
      availabilityV2 { status }
      prices { price { value currencyCode } }
      variants(first: 50) {
        edges {
          node {
            entityId
            sku
            isPurchasable
            prices { price { value } }
            options { edges { node { values { edges { node { label } } } } } }
          }
        }
      }
    }
  }
}`;

type BigCommerceProduct = {
  name: string;
  sku?: string;
  plainTextDescription?: string;
  defaultImage?: { url: string } | null;
  availabilityV2?: { status: string };
  prices?: { price?: { value: number; currencyCode: string } } | null;
  variants: {
    edges: {
      node: {
        entityId: number;
        sku?: string;
        isPurchasable?: boolean;
        prices?: { price?: { value: number } } | null;
        options: { edges: { node: { values: { edges: { node: { label: string } }[] } } }[] };
      };
    }[];
  };
};

async function tryBigCommerce(url: URL, html: string, page: PageScan) {
  // The token sits in an escaped JSON blob: "graphQLToken\":\"eyJ...\"
  const token = html.match(/graphQLToken\\?"\s*:\s*\\?"([^"\\]+)/)?.[1];
  const productId = Number(page.productIdInput);
  if (!token || !productId) return null;

  const res = await meteredFetch(new URL("/graphql", url.origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": HONEST_UA,
    },
    body: JSON.stringify({ query: BIGCOMMERCE_QUERY, variables: { id: productId } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: { site?: { product?: BigCommerceProduct } };
  } | null;
  const product = body?.data?.site?.product;
  if (!res.ok || !product) return null;

  const variants: PartVariant[] = product.variants.edges.map(({ node }) => ({
    id: String(node.entityId),
    title:
      node.options.edges.flatMap((o) => o.node.values.edges.map((v) => v.node.label)).join(" / ") ||
      "Default",
    sku: node.sku || undefined,
    price: node.prices?.price?.value,
    available: node.isPurchasable,
  }));
  return {
    source: "bigcommerce" as const,
    title: product.name,
    sku: product.sku || undefined,
    description: truncate(product.plainTextDescription),
    image: product.defaultImage?.url,
    price: product.prices?.price?.value,
    currency: product.prices?.price?.currencyCode,
    available: product.availabilityV2 ? product.availabilityV2.status === "Available" : undefined,
    variants,
  };
}

// --- JSON-LD ---------------------------------------------------------------

type LdNode = Record<string, unknown>;

function fromJsonLd(page: PageScan) {
  const nodes: LdNode[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      const node = value as LdNode;
      nodes.push(node);
      if (node["@graph"]) collect(node["@graph"]);
    }
  };
  for (const raw of page.jsonLd) {
    try {
      collect(JSON.parse(raw));
    } catch {
      // Malformed blocks are common; skip them.
    }
  }

  const isType = (node: LdNode, type: string) => {
    const t = node["@type"];
    return t === type || (Array.isArray(t) && t.includes(type));
  };
  const product =
    nodes.find((n) => isType(n, "ProductGroup")) ?? nodes.find((n) => isType(n, "Product"));
  const title = str(product?.name);
  if (!product || !title) return null;

  const productOffer = firstOffer(product.offers);
  const children = Array.isArray(product.hasVariant) ? (product.hasVariant as LdNode[]) : [];
  const variants: PartVariant[] = children.map((v, i) => {
    const offer = firstOffer(v.offers);
    return {
      id: str(v.sku) ?? str(v["@id"]) ?? String(i),
      title: str(v.name) ?? title,
      sku: str(v.sku),
      price: offer.price,
      available: offer.available,
    };
  });

  return {
    source: "json-ld" as const,
    title,
    sku: str(product.sku) ?? str(product.mpn),
    description: truncate(str(product.description)),
    image: ldImage(product.image),
    price: productOffer.price ?? variants[0]?.price,
    currency: productOffer.currency ?? firstOffer(children[0]?.offers).currency,
    available: productOffer.available,
    variants,
  };
}

function firstOffer(offers: unknown): { price?: number; currency?: string; available?: boolean } {
  const offer = (Array.isArray(offers) ? offers[0] : offers) as LdNode | undefined;
  if (!offer || typeof offer !== "object") return {};
  const spec = (
    Array.isArray(offer.priceSpecification) ? offer.priceSpecification[0] : offer.priceSpecification
  ) as LdNode | undefined;
  const availability = str(offer.availability);
  return {
    price: parsePrice(str(offer.price) ?? str(offer.lowPrice) ?? str(spec?.price)),
    currency: str(offer.priceCurrency) ?? str(spec?.priceCurrency),
    available: availability
      ? /InStock|LimitedAvailability|PreOrder/i.test(availability)
      : undefined,
  };
}

function ldImage(image: unknown): string | undefined {
  if (Array.isArray(image)) return ldImage(image[0]);
  if (typeof image === "string") return image;
  if (image && typeof image === "object")
    return str((image as LdNode).url) ?? str((image as LdNode).contentUrl);
  return undefined;
}

// --- McMaster-Carr ---------------------------------------------------------

/**
 * McMaster renders everything client-side and loads prices through session-bound
 * calls, and its API is B2B-only, so the part number from the URL is all we can
 * count on. Popular parts have a prerendered page whose <title> is "<part> | <name> |
 * McMaster-Carr"; the fallback uses that name when it's there.
 */
async function lookupMcMaster(input: URL): Promise<PartLookup> {
  // Accepts /91251A540/, /product/91251A540, and dash-joined lists like
  // /1575A65-1575A11/ (a page showing several parts; the order was one of them).
  const segment = input.pathname.match(
    /^\/(?:product\/)?(\d{2,5}[A-Z]{1,2}\d{1,4}(?:-\d{2,5}[A-Z]{1,2}\d{1,4})*)(?:\/|$)/i,
  )?.[1];
  if (!segment) throw new LookupError("That McMaster link isn't a part page.", 400);
  const partNumbers = segment.toUpperCase().split("-");
  const partNumber = partNumbers[0];
  const url = new URL(`/${partNumber}/`, "https://www.mcmaster.com");
  const base = {
    url: url.toString(),
    source: "mcmaster" as const,
    vendor: "mcmaster.com",
    sku: partNumber,
    variants:
      partNumbers.length > 1 ? partNumbers.map((pn) => ({ id: pn, title: pn, sku: pn })) : [],
  };

  let name: string | undefined;
  const res = await get(url, { "User-Agent": HONEST_UA, Accept: "text/html" });
  if (res.ok) {
    const page = await scanPage(await res.text());
    const [titlePart, titleName] = page.title?.split(" | ") ?? [];
    if (titlePart?.toUpperCase() === partNumber) name = titleName;
  }
  return { ...base, title: name ?? `McMaster-Carr ${partNumber}` };
}

// --- DigiKey ---------------------------------------------------------------

const DIGIKEY_API = "https://api.digikey.com";
let digikeyToken: { value: string; expiresAt: number } | undefined;

type DigiKeyPriceBreak = { BreakQuantity: number; UnitPrice: number };

type DigiKeyProduct = {
  Description?: { ProductDescription?: string; DetailedDescription?: string };
  Manufacturer?: { Name?: string };
  ManufacturerProductNumber?: string;
  UnitPrice?: number;
  ProductUrl?: string;
  PhotoUrl?: string;
  QuantityAvailable?: number;
  ProductVariations?: {
    DigiKeyProductNumber: string;
    PackageType?: { Name?: string };
    StandardPricing?: DigiKeyPriceBreak[];
    MinimumOrderQuantity?: number;
    QuantityAvailableforPackageType?: number;
  }[];
};

/**
 * DigiKey's site sits behind a Cloudflare bot check, so only the Product
 * Information API works. Links look like
 * /en/products/detail/<manufacturer>/<mfr part number>/<internal id>, or the
 * older /product-detail/en/<manufacturer>/<mfr part number>/<DigiKey part number>/<id>.
 */
async function lookupDigiKey(url: URL, credentials: LookupOptions["digikey"]): Promise<PartLookup> {
  if (!credentials?.clientId || !credentials.clientSecret) {
    throw new LookupError(
      "DigiKey blocks scraping; set the DigiKey API credentials to look up its parts.",
      502,
    );
  }

  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const detail = parts.indexOf("detail");
  const legacy = parts.indexOf("product-detail");
  const productNumber =
    detail !== -1 && parts[detail + 2]
      ? parts[detail + 2] // manufacturer part number
      : legacy !== -1
        ? (parts[legacy + 4] ?? parts[legacy + 3]) // DigiKey part number, else mfr part number
        : undefined;
  if (!productNumber) throw new LookupError("That DigiKey link isn't a product page.", 400);

  const res = await digikeyRequest(
    credentials,
    `/products/v4/search/${encodeURIComponent(productNumber)}/productdetails`,
  );
  if (res.status === 404) {
    throw new LookupError(`DigiKey has no product ${productNumber}.`, 404);
  }
  if (!res.ok) throw new LookupError(`DigiKey API error: ${await apiErrorMessage(res)}`, 502);
  const product = ((await res.json()) as { Product?: DigiKeyProduct }).Product;
  if (!product) throw new LookupError(`DigiKey has no product ${productNumber}.`, 404);

  const variants: PartVariant[] = (product.ProductVariations ?? []).map((v) => {
    const breaks = [...(v.StandardPricing ?? [])].sort((a, b) => a.BreakQuantity - b.BreakQuantity);
    return {
      id: v.DigiKeyProductNumber,
      title: v.PackageType?.Name ?? v.DigiKeyProductNumber,
      sku: v.DigiKeyProductNumber,
      price: breaks[0]?.UnitPrice,
      available:
        v.QuantityAvailableforPackageType === undefined
          ? undefined
          : v.QuantityAvailableforPackageType > 0,
    };
  });
  // Default to the packaging you can buy one of (cut tape / bulk) rather than a full reel.
  const orderable = [...(product.ProductVariations ?? [])].sort(
    (a, b) => (a.MinimumOrderQuantity ?? 1) - (b.MinimumOrderQuantity ?? 1),
  )[0];
  const primary = variants.find((v) => v.id === orderable?.DigiKeyProductNumber);

  return {
    url: product.ProductUrl ?? url.toString(),
    source: "digikey",
    vendor: "digikey.com",
    title:
      product.Description?.ProductDescription ?? product.ManufacturerProductNumber ?? productNumber,
    sku: primary?.sku,
    description: truncate(product.Description?.DetailedDescription),
    image: product.PhotoUrl,
    price: primary?.price ?? product.UnitPrice,
    currency: "USD",
    available: product.QuantityAvailable === undefined ? undefined : product.QuantityAvailable > 0,
    manufacturer: product.Manufacturer?.Name,
    mpn: product.ManufacturerProductNumber,
    variants,
  };
}

type DigiKeyAuth = { clientId: string; clientSecret: string };

async function digikeyRequest(auth: DigiKeyAuth, path: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await digikeyAuth(auth);
    const res = await apiFetch(`${DIGIKEY_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-DIGIKEY-Client-Id": auth.clientId,
        "X-DIGIKEY-Locale-Site": "US",
        "X-DIGIKEY-Locale-Currency": "USD",
        "X-DIGIKEY-Locale-Language": "en",
      },
    });
    if (res.status !== 401) return res;
    digikeyToken = undefined;
  }
  throw new LookupError("DigiKey API rejected our credentials.", 502);
}

/** Client-credentials ("2-legged") OAuth; tokens last about 10 minutes. */
async function digikeyAuth(auth: DigiKeyAuth) {
  if (digikeyToken && digikeyToken.expiresAt > Date.now() + 30_000) return digikeyToken.value;
  const res = await apiFetch(`${DIGIKEY_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new LookupError(`DigiKey API login failed: ${await apiErrorMessage(res)}`, 502);
  }
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  digikeyToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 600) * 1000,
  };
  return digikeyToken.value;
}

// --- API helpers -----------------------------------------------------------

/** Fetch with a timeout. */
async function apiFetch(url: string, init: RequestInit) {
  try {
    return await meteredFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new LookupError(
      `Could not reach ${new URL(url).hostname}: ${(err as Error).message}`,
      502,
    );
  }
}

/** Pulls a readable message out of an API error body, falling back to the status code. */
async function apiErrorMessage(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const message = body.ErrorMessage ?? body.Message ?? body.detail ?? body.message ?? body.error;
    if (typeof message === "string" && message) return `${message} (HTTP ${res.status})`;
  } catch {
    // Not JSON.
  }
  return `HTTP ${res.status}`;
}

// --- Amazon ----------------------------------------------------------------

/** Share-link domains that redirect to an Amazon product page. */
const AMAZON_SHORT_HOSTS = new Set(["a.co", "amzn.to", "amzn.eu", "amzn.asia", "amzn.com"]);
const AMAZON_CURRENCIES: Record<string, string> = {
  "amazon.com": "USD",
  "amazon.ca": "CAD",
  "amazon.co.uk": "GBP",
  "amazon.de": "EUR",
  "amazon.fr": "EUR",
  "amazon.it": "EUR",
  "amazon.es": "EUR",
};

function isAmazonHost(hostname: string) {
  return /(^|\.)amazon\.[a-z.]+$/.test(hostname);
}

/** Follows share-link redirects (a.co/d/..., amzn.to/...) until they land on an Amazon page. */
async function resolveAmazonShortLink(url: URL, client: ClientHeaders | undefined) {
  let current = url;
  for (let hop = 0; hop < 5 && !isAmazonHost(current.hostname); hop++) {
    let res: Response;
    try {
      // a.co answers HEAD with 404, so this has to be a GET.
      res = await meteredFetch(current, {
        headers: amazonHeaders(client),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new LookupError(`Could not reach ${current.hostname}: ${(err as Error).message}`, 502);
    }
    const location = res.headers.get("location");
    if (!location) throw new LookupError("Amazon short link didn't redirect anywhere.", 404);
    current = new URL(location, current);
  }
  if (!isAmazonHost(current.hostname)) {
    throw new LookupError("Short link doesn't lead to an Amazon page.", 400);
  }
  return current;
}

async function lookupAmazon(input: URL, client: ClientHeaders | undefined): Promise<PartLookup> {
  const resolved = AMAZON_SHORT_HOSTS.has(input.hostname)
    ? await resolveAmazonShortLink(input, client)
    : input;

  // Product URLs come in many shapes (/dp/, /gp/product/, /Some-Name/dp/...) and
  // carry tracking params; /dp/<ASIN> is the stable form.
  const asin = resolved.pathname.match(
    /\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i,
  )?.[1];
  if (!asin) throw new LookupError("That Amazon link isn't a product page.", 400);
  const url = new URL(`/dp/${asin.toUpperCase()}`, resolved.origin);

  const html = await getHtml(url, amazonHeaders(client));
  const page = await scanPage(html);
  const title = amazonTitleOf(page);
  if (!title) {
    throw new LookupError(
      isAmazonCaptcha(html)
        ? "Amazon asked for a CAPTCHA (a bot check), so the page couldn't be read."
        : "Couldn't find the product on Amazon's page.",
      502,
    );
  }

  const wholeAndFraction =
    page.amazonPriceWhole &&
    `${page.amazonPriceWhole.replace(/\D/g, "")}.${page.amazonPriceFraction?.replace(/\D/g, "") || "00"}`;
  const price =
    parsePrice(page.amazonPrice) ??
    parsePrice(html.match(/"priceAmount"\s*:\s*([\d.]+)/)?.[1]) ??
    parsePrice(wholeAndFraction);
  const site = url.hostname.replace(/^www\./, "");

  return {
    url: url.toString(),
    source: "amazon",
    vendor: site,
    title,
    sku: asin.toUpperCase(),
    image: page.amazonImage ?? page.meta["og:image"],
    price,
    currency: price === undefined ? undefined : AMAZON_CURRENCIES[site],
    available: page.amazonAvailability ? /in stock/i.test(page.amazonAvailability) : undefined,
    variants: [],
  };
}

/**
 * The product's name: the desktop page's title, the mobile page's, or the page's own title
 * ("Amazon.com: <name> : <category>") with Amazon's parts taken off.
 */
function amazonTitleOf(page: PageScan): string | undefined {
  if (page.amazonTitle) return page.amazonTitle;
  if (page.amazonMobileTitle) return page.amazonMobileTitle;
  for (const raw of [page.meta["og:title"], page.title]) {
    const name = raw
      ?.replace(/^Amazon\.[a-z.]+\s*:\s*/i, "")
      .replace(/\s+:\s+[^:]+$/, "")
      .trim();
    if (name && !/^Amazon(\.[a-z.]+)?$/i.test(name)) return name;
  }
  return undefined;
}

/** Amazon's bot check: a CAPTCHA page in place of the product. */
function isAmazonCaptcha(html: string): boolean {
  return /\/errors\/validateCaptcha|Type the characters you see|Enter the characters you see/i.test(
    html,
  );
}

// --- Page scanning ---------------------------------------------------------

type PageScan = {
  meta: Record<string, string>;
  itemprop: Record<string, string>;
  jsonLd: string[];
  title?: string;
  h1?: string;
  productIdInput?: string;
  amazonTitle?: string;
  /** The mobile page's title element. */
  amazonMobileTitle?: string;
  amazonPrice?: string;
  amazonPriceWhole?: string;
  amazonPriceFraction?: string;
  amazonImage?: string;
  amazonAvailability?: string;
};

type TextField =
  | "title"
  | "h1"
  | "amazonTitle"
  | "amazonMobileTitle"
  | "amazonPrice"
  | "amazonPriceWhole"
  | "amazonPriceFraction"
  | "amazonAvailability";

/** An Amazon price element that isn't a per-unit or list ("was") price. */
const AMAZON_PRICE = ".a-price:not(.a-text-price)";

/** One streaming pass over the page with HTMLRewriter, collecting everything the parsers above need. */
async function scanPage(html: string): Promise<PageScan> {
  const scan: PageScan = { meta: {}, itemprop: {}, jsonLd: [] };
  // First non-empty text in page order. Several selectors can feed one field, so a field that's
  // already set is never overwritten by a later match.
  const firstText = (key: TextField) => {
    let buffer = "";
    return {
      text(chunk: Text) {
        if (scan[key] !== undefined) return;
        buffer += chunk.text;
        if (!chunk.lastInTextNode) return;
        if (buffer.trim()) scan[key] = decodeEntities(buffer.trim().replace(/\s+/g, " "));
        buffer = "";
      },
    };
  };
  let ldBuffer = "";

  await new HTMLRewriter()
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("property") ?? el.getAttribute("name"))?.toLowerCase();
        const content = el.getAttribute("content");
        if (key && content && !(key in scan.meta)) scan.meta[key] = decodeEntities(content.trim());
        const itemprop = el.getAttribute("itemprop");
        if (itemprop && content && !(itemprop in scan.itemprop))
          scan.itemprop[itemprop] = content.trim();
      },
    })
    .on('script[type="application/ld+json"]', {
      text(chunk) {
        ldBuffer += chunk.text;
        if (chunk.lastInTextNode) {
          scan.jsonLd.push(ldBuffer);
          ldBuffer = "";
        }
      },
    })
    .on('input[name="product_id"]', {
      element(el) {
        scan.productIdInput ??= el.getAttribute("value") ?? undefined;
      },
    })
    .on("title", firstText("title"))
    .on("h1", firstText("h1"))
    .on("#productTitle", firstText("amazonTitle"))
    .on("#title", firstText("amazonMobileTitle"))
    // The buy-box price; other .a-price elements on the page belong to ads and related items.
    // The buy-box price to pay. `.a-text-price` marks the other prices shown beside it (per-unit
    // like "$0.05 / foot", and the struck-through list price), which must never be taken instead.
    .on(`#corePrice_feature_div ${AMAZON_PRICE} .a-offscreen`, firstText("amazonPrice"))
    .on(
      `#corePriceDisplay_desktop_feature_div ${AMAZON_PRICE} .a-offscreen`,
      firstText("amazonPrice"),
    )
    .on(`#corePrice_feature_div ${AMAZON_PRICE} .a-price-whole`, firstText("amazonPriceWhole"))
    .on(
      `#corePriceDisplay_desktop_feature_div ${AMAZON_PRICE} .a-price-whole`,
      firstText("amazonPriceWhole"),
    )
    .on(
      `#corePrice_feature_div ${AMAZON_PRICE} .a-price-fraction`,
      firstText("amazonPriceFraction"),
    )
    .on(
      `#corePriceDisplay_desktop_feature_div ${AMAZON_PRICE} .a-price-fraction`,
      firstText("amazonPriceFraction"),
    )
    .on("#availability", firstText("amazonAvailability"))
    .on("#landingImage", {
      element(el) {
        scan.amazonImage ??=
          el.getAttribute("data-old-hires") || el.getAttribute("src") || undefined;
      },
    })
    .transform(new Response(html))
    .arrayBuffer();

  return scan;
}

// --- Helpers ---------------------------------------------------------------

async function getHtml(url: URL, headers: Record<string, string>) {
  const res = await get(url, { ...headers, Accept: "text/html,application/xhtml+xml" });
  // Sites behind Cloudflare bot management (DigiKey, ...) answer with a JS
  // challenge page that only a real browser can pass.
  if (res.headers.get("cf-mitigated") === "challenge") {
    throw new LookupError(
      `${url.hostname} blocks automated requests with a bot check, so its pages can't be read.`,
      502,
    );
  }
  if (res.status === 403) {
    throw new LookupError(
      `${url.hostname} refused the request (HTTP 403); it likely blocks bots.`,
      502,
    );
  }
  if (!res.ok) {
    throw new LookupError(
      `Vendor site returned HTTP ${res.status}.`,
      res.status === 404 ? 404 : 502,
    );
  }
  return res.text();
}

async function get(url: URL, headers: Record<string, string>) {
  try {
    return await meteredFetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new LookupError(`Could not reach ${url.hostname}: ${(err as Error).message}`, 502);
  }
}

function withSelectedVariant(result: PartLookup, variantId: string | undefined): PartLookup {
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

function parsePrice(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  let normalized = value.replace(/[^0-9.,]/g, "");
  // "12,50" is a decimal comma; "1,250.00" is a thousands separator.
  normalized =
    /,\d{2}$/.test(normalized) && !normalized.includes(".")
      ? normalized.replace(",", ".")
      : normalized.replace(/,/g, "");
  const price = Number(normalized);
  return normalized && Number.isFinite(price) ? price : undefined;
}

function str(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

function stripHtml(value: string | undefined) {
  return value
    ? decodeEntities(value.replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim()
    : undefined;
}

function truncate(value: string | undefined) {
  if (!value) return undefined;
  return value.length > MAX_DESCRIPTION ? `${value.slice(0, MAX_DESCRIPTION - 1)}…` : value;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? Number.parseInt(code.slice(2), 16)
          : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}
