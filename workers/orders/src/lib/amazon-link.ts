import { isAmazonShortLink } from "./product-key";

// Amazon's share links (a.co/d/..., what the app's Share button copies) hide the product's ASIN,
// which Amazon's carts need. Following the link's redirect gives the product page. Only the
// redirect is fetched, never the page, so Amazon's bot check doesn't come into it.

const HOPS = 5;
const TIMEOUT_MS = 4_000;

const isAmazonHost = (hostname: string) => /(^|\.)amazon\.[a-z.]+$/i.test(hostname);

/**
 * The product page a share link leads to, as `https://www.amazon.<tld>/dp/<ASIN>`; any other link
 * as it is. Also the link as it is when the redirect can't be followed: it's saved anyway.
 */
export async function expandAmazonLink(raw: string): Promise<string> {
  if (!isAmazonShortLink(raw)) return raw;
  let current = new URL(raw);
  try {
    for (let hop = 0; hop < HOPS && !isAmazonHost(current.hostname); hop++) {
      // a.co answers HEAD with 404, so this has to be a GET.
      const res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await res.body?.cancel();
      const location = res.headers.get("location");
      if (!location) return raw;
      current = new URL(location, current);
    }
  } catch {
    return raw;
  }
  const asin = current.pathname.match(
    /\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i,
  )?.[1];
  if (!isAmazonHost(current.hostname) || !asin) return raw;
  return `${current.origin}/dp/${asin.toUpperCase()}`;
}
