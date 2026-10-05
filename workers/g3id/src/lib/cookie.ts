// The session cookie is shared by every subdomain of the domain the request came in on: the site
// team's own domain, or the platform's for every other team (the gateway keeps each team's
// sessions to its own hosts).
function cookieDomain(requestUrl: string): string | undefined {
  try {
    const { hostname } = new URL(requestUrl);
    if (hostname === "localhost") return "localhost";
    // For subdomains like g3id.<domain>, share the cookie across all of the domain's subdomains
    const parts = hostname.split(".");
    if (parts.length >= 2) return parts.slice(-2).join(".");
  } catch {}
  return undefined;
}

export function sessionCookieOptions(requestUrl: string) {
  const domain = cookieDomain(requestUrl);
  let secure = true;
  try {
    secure = new URL(requestUrl).protocol === "https:";
  } catch {}
  return {
    httpOnly: true,
    secure,
    sameSite: "Lax" as const,
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

export function deleteCookieOptions(requestUrl: string) {
  const domain = cookieDomain(requestUrl);
  return {
    path: "/",
    ...(domain ? { domain } : {}),
  };
}
