import { site } from "@g3/site-config";

export function sanitizeRedirect(redirect: string | undefined | null): string | null {
  if (!redirect) return null;
  try {
    const url = new URL(redirect);
    const { hostname } = url;
    if (
      hostname === site.domain ||
      hostname.endsWith(`.${site.domain}`) ||
      hostname === "localhost"
    ) {
      return redirect;
    }
  } catch {
    if (redirect.startsWith("/")) return redirect;
  }
  return null;
}
