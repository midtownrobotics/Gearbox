function cookieDomain(frontendUrl: string): string | undefined {
  try {
    const { hostname } = new URL(frontendUrl);
    if (hostname === "localhost") return "localhost";
    // For subdomains like g3id.<domain>, share the cookie across all of the domain's subdomains
    const parts = hostname.split(".");
    if (parts.length >= 2) return parts.slice(-2).join(".");
  } catch {}
  return undefined;
}

export function sessionCookieOptions(frontendUrl: string) {
  const domain = cookieDomain(frontendUrl);
  let secure = true;
  try {
    secure = new URL(frontendUrl).protocol === "https:";
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

export function deleteCookieOptions(frontendUrl: string) {
  const domain = cookieDomain(frontendUrl);
  return {
    path: "/",
    ...(domain ? { domain } : {}),
  };
}
