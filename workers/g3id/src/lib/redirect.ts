import { consoleUrl, teamOfHost } from "@g3/site-config";

/**
 * Where a sign-in may send someone afterwards: a page of the team they're signing in to, the
 * platform operators' console on the team's domain (an operator signs in through their own team),
 * a path on G3ID's own page, or localhost (dev). Anything else (another team's pages, other sites)
 * is dropped.
 */
export function sanitizeRedirect(redirect: string | undefined | null, team: string): string | null {
  if (!redirect) return null;
  if (redirect.startsWith("/") && !redirect.startsWith("//")) return redirect;
  try {
    const { hostname, protocol } = new URL(redirect);
    if (hostname === "localhost") return redirect;
    if (protocol === "https:" && teamOfHost(hostname) === team) return redirect;
    if (protocol === "https:" && hostname === new URL(consoleUrl(team)).hostname) return redirect;
  } catch {}
  return null;
}
