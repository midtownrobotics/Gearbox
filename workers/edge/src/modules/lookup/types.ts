/**
 * Wire types for part lookup: orders worker → edge worker → the agent's lookup
 * module. Plain types only (no runtime imports), so the agent and other workers
 * can import them (package export "@g3/worker-edge/lookup-types").
 */

export type PartSource =
  | "shopify"
  | "bigcommerce"
  | "json-ld"
  | "amazon"
  | "mcmaster"
  | "digikey"
  | "meta";

export type PartVariant = {
  id: string;
  title: string;
  sku?: string;
  price?: number;
  available?: boolean;
};

export type PartLookup = {
  url: string;
  source: PartSource;
  vendor: string;
  title: string;
  sku?: string;
  description?: string;
  image?: string;
  price?: number;
  currency?: string;
  /** What `price` buys when it isn't one item, e.g. McMaster's "Pack of 100". */
  priceUnit?: string;
  available?: boolean;
  manufacturer?: string;
  /** Manufacturer part number, when it differs from the vendor's `sku` (DigiKey). */
  mpn?: string;
  variants: PartVariant[];
  /** From the `?variant=` query param; top-level sku/price come from it when it matches. */
  selectedVariantId?: string;
};

/**
 * The requesting browser's own headers, passed along so page fetches that have to look like a
 * browser look like that person's actual browser. Never cookies or auth.
 */
export type ClientHeaders = {
  userAgent?: string;
  acceptLanguage?: string;
  secChUa?: string;
  secChUaMobile?: string;
  secChUaPlatform?: string;
};

/** Request headers forwarded as ClientHeaders, by header name. */
export const CLIENT_HEADER_NAMES = {
  userAgent: "user-agent",
  acceptLanguage: "accept-language",
  secChUa: "sec-ch-ua",
  secChUaMobile: "sec-ch-ua-mobile",
  secChUaPlatform: "sec-ch-ua-platform",
} as const satisfies Record<keyof ClientHeaders, string>;

export type LookupRequest = { url: string; client?: ClientHeaders };

/**
 * Usage pseudo-client for the box's part-lookup traffic, alongside "_wan" in the network
 * module's usage buckets. Keys starting with "_" are never LAN clients.
 */
export const LOOKUP_USAGE_KEY = "_lookup";
