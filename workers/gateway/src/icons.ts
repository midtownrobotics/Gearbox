import { type TeamUiSettings, brandColor, builtInBrandColor } from "@g3/site-config";
import { type Pixels, decodePng, encodePng } from "./png";

// Installed apps' icons in the team's color. A page recolors its own tab and touch icons in the
// browser (applyTabIcons in @g3/ui), but an installed app's icon is whatever its manifest names,
// fetched by the browser or the phone's launcher without running the page. So for a team whose
// brand color isn't the built-in one, the gateway changes them on the way out:
// - the app's /manifest.webmanifest gets `?v=<color>` on each icon's address, so a change of
//   color is a new address and installed apps pick it up;
// - each icon file (ICON_FILES) has its accent, drawn in the built-in brand color, swapped for the
//   team's. The files are a black tile with a white drawing and that one accent, smoothed at their
//   edges, so each pixel is a mix of the accent, white and black: it's remixed with the team's
//   color in the accent's place.
// A team on the built-in color, or one whose color can't be read, gets the files as they are.

/** The icon files the manifests and index.html name (Pit's and Shop's PWA plugins add pwa-*). */
export const ICON_FILES = new Set([
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/icon-512-maskable.png",
  "/pwa-192x192.png",
  "/pwa-512x512.png",
]);

export const MANIFEST = "/manifest.webmanifest";

const TTL_MS = 60_000;
const colors = new Map<string, { color: string | null; until: number }>();

/** The team's brand color when it isn't the built-in one, else null. Remembered for a minute. */
async function teamColor(g3id: Fetcher, team: string): Promise<string | null> {
  const hit = colors.get(team);
  if (hit && hit.until > Date.now()) return hit.color;
  let color: string | null = null;
  try {
    const res = await g3id.fetch(
      new Request("http://g3id/api/team/ui", { headers: { "X-Team-Id": team } }),
    );
    if (res.ok) {
      const settings = (await res.json()) as Partial<TeamUiSettings>;
      const accent = settings.light?.accent;
      if (typeof accent === "string") {
        const brand = brandColor({ light: { ...settings.light, accent } } as TeamUiSettings);
        if (/^#[0-9a-f]{6}$/.test(brand) && brand !== builtInBrandColor) color = brand;
      }
    }
  } catch (err) {
    console.error("[gateway] team colors", err);
  }
  if (colors.size >= 1000) colors.clear();
  colors.set(team, { color, until: Date.now() + TTL_MS });
  return color;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);

/** `pixels` with the built-in accent (and its mixes with white and black) in `color`. */
export function recolorPixels(pixels: Pixels, color: string): Pixels {
  const [ar, ag, ab] = rgb(builtInBrandColor);
  const [nr, ng, nb] = rgb(color);
  // Each pixel as a·accent + w·white (+ black for the rest), by least squares.
  const aa = ar * ar + ag * ag + ab * ab;
  const as = ar + ag + ab;
  const det = 3 * aa - as * as;
  const data = new Uint8Array(pixels.data);
  const { channels } = pixels;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const dot = ar * r + ag * g + ab * b;
    const sum = r + g + b;
    let a = (3 * dot - as * sum) / det;
    let w = (aa * sum - as * dot) / det;
    a = Math.min(Math.max(a, 0), 1);
    w = Math.min(Math.max(w, 0), 1 - a);
    // Grays (no accent in them) and colors that aren't such a mix stay as they are.
    if (a < 0.01) continue;
    const off = Math.max(
      Math.abs(a * ar + w - r),
      Math.abs(a * ag + w - g),
      Math.abs(a * ab + w - b),
    );
    if (off > 0.08) continue;
    data[i] = Math.round((a * nr + w) * 255);
    data[i + 1] = Math.round((a * ng + w) * 255);
    data[i + 2] = Math.round((a * nb + w) * 255);
  }
  return { ...pixels, data };
}

/** A PNG with its accent in `color`, or null when it isn't a PNG this can read. */
export async function recolorPng(png: Uint8Array, color: string): Promise<Uint8Array | null> {
  const decoded = await decodePng(png);
  if (!decoded) return null;
  return encodePng(recolorPixels(decoded.pixels, color), decoded.chunks);
}

/** A manifest with `?v=<color>` on each of its own icon files' addresses. */
export function rewriteManifest(text: string, base: URL, color: string): string | null {
  let manifest: { icons?: { src?: unknown }[] };
  try {
    manifest = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(manifest.icons)) return null;
  for (const icon of manifest.icons) {
    if (typeof icon?.src !== "string") continue;
    const src = new URL(icon.src, base);
    if (src.origin !== base.origin || !ICON_FILES.has(src.pathname)) continue;
    src.searchParams.set("v", color.slice(1));
    icon.src = `${src.pathname}${src.search}`;
  }
  return JSON.stringify(manifest);
}

const recolored = new Map<string, Uint8Array>();

/**
 * The app's manifest or one of its icon files, for a team with its own color; null for any other
 * request (and for a team on the built-in color), which goes on as usual. `original` fetches the
 * file from the app.
 */
export async function teamIcon(
  request: Request,
  url: URL,
  team: string,
  g3id: Fetcher,
  original: (path: string) => Promise<Response>,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const { pathname } = url;
  if (pathname !== MANIFEST && !ICON_FILES.has(pathname)) return null;
  const color = await teamColor(g3id, team);
  if (!color) return null;

  const key = `${url.host}${pathname}${color}`;
  let body: string | Uint8Array | undefined = recolored.get(key);
  let headers: Headers;
  if (pathname === MANIFEST) {
    const res = await original(pathname);
    if (!res.ok) return res;
    const text = rewriteManifest(await res.text(), url, color);
    if (text === null) return null;
    body = text;
    headers = new Headers({
      "Content-Type": res.headers.get("Content-Type") ?? "application/manifest+json",
      "Cache-Control": "no-cache",
    });
  } else {
    if (!body) {
      const res = await original(pathname);
      if (!res.ok) return res;
      const png = await recolorPng(new Uint8Array(await res.arrayBuffer()), color);
      if (!png) return null;
      body = png;
      if (recolored.size >= 50) recolored.clear();
      recolored.set(key, png);
    }
    // The manifest's addresses name the color, so those can be kept; index.html's can't.
    const current = url.searchParams.get("v") === color.slice(1);
    headers = new Headers({
      "Content-Type": "image/png",
      "Cache-Control": current ? "public, max-age=86400" : "public, max-age=300",
    });
  }
  return new Response(request.method === "HEAD" ? null : body, { headers });
}
