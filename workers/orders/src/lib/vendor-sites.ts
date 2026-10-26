/**
 * The FRC vendors Orders knows by their sites: how a part is looked up there without the team's
 * edge box (`vendor-lookup.ts`), and their names on VendorDiff, which tracks their prices and
 * stock. Plain data, so the app imports it too (`@g3/worker-orders/vendor-sites`).
 */

export type VendorSite = {
  /** VendorDiff's name for the vendor (`/search?vendor=<slug>`). */
  slug: string;
  name: string;
  /**
   * `shopify`: the store's public Storefront API (any Shopify store works; these are the ones a
   * link to a page that isn't `/products/…` is followed for). `rev`: REV's product feed.
   */
  platform: "shopify" | "rev";
  /** Hostnames without `www.`. */
  hosts: string[];
};

export const VENDOR_SITES: VendorSite[] = [
  { slug: "andymark", name: "AndyMark", platform: "shopify", hosts: ["andymark.com"] },
  { slug: "armabot", name: "Armabot", platform: "shopify", hosts: ["armabot.com"] },
  {
    slug: "ctre",
    name: "CTRE",
    platform: "shopify",
    hosts: ["store.ctr-electronics.com", "ctr-electronics.com"],
  },
  { slug: "lastanvil", name: "Last Anvil", platform: "shopify", hosts: ["lastanvil.com"] },
  { slug: "limelight", name: "Limelight", platform: "shopify", hosts: ["limelightvision.io"] },
  { slug: "rev", name: "REV Robotics", platform: "rev", hosts: ["revrobotics.com"] },
  {
    slug: "sds",
    name: "Swerve Drive Specialties",
    platform: "shopify",
    hosts: ["swervedrivespecialties.com"],
  },
  {
    slug: "swyft",
    name: "Swyft Robotics",
    platform: "shopify",
    hosts: ["shop.swyftrobotics.com", "swyftrobotics.com"],
  },
  {
    slug: "thriftybot",
    name: "The Thrifty Bot",
    platform: "shopify",
    hosts: ["thethriftybot.com"],
  },
  { slug: "wcp", name: "WCP", platform: "shopify", hosts: ["wcproducts.com"] },
];

/** The vendor a link is to, by its hostname. */
export function vendorSiteOf(link: string): VendorSite | undefined {
  let host: string;
  try {
    host = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  return VENDOR_SITES.find((site) => site.hosts.includes(host));
}

/** VendorDiff: a public tracker of FRC vendors' prices and stock (github.com/tervay/public-vendordiff). */
export const VENDORDIFF_URL = "https://public-vendordiff.vercel.app";

/**
 * The part on VendorDiff: its search for the part number at that vendor, or null when the link
 * isn't to a vendor it tracks or there's no part number. (Its own pages are by its own ids.)
 */
export function vendorDiffUrl(link: string, sku: string | null | undefined): string | null {
  const site = vendorSiteOf(link);
  if (!site || !sku?.trim()) return null;
  return `${VENDORDIFF_URL}/search?${new URLSearchParams({ vendor: site.slug, q: sku.trim() })}`;
}
