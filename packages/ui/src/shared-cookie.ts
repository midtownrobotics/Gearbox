import { DEV_DOMAIN, site } from "@g3/site-config";

/**
 * The attributes for a cookie every page on the platform's domain shares (each team's apps, its
 * home, the platform's own site), or in dev the gateway's (gearbox.localhost) or plain localhost.
 * localStorage is per subdomain, so settings for all of them live in cookies.
 */
export function sharedCookieAttributes(maxAgeSeconds: number): string {
  const host = window.location.hostname;
  const shared = [site.platformDomain, DEV_DOMAIN, "localhost"].find(
    (d) => host === d || host.endsWith(`.${d}`),
  );
  const domain = shared ? `; domain=${shared}` : "";
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  return `path=/; max-age=${maxAgeSeconds}; samesite=lax${domain}${secure}`;
}
