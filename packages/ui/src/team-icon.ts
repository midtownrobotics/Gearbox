import { builtInBrandColor } from "@g3/site-config";

// App icons in a team's colour. Every app's icon is a black tile with a white drawing and one
// accent, drawn in the built-in brand colour. A team's brand colour (its light accent in Team
// Appearance) takes the accent's place: the icon's SVG is read, the accent swapped, and the result
// used wherever the icon shows (the top bar, the browser tab, the home-screen icon, the app list's
// tiles). The files themselves stay as they are, so a team with the default colour changes nothing.

/** The colour the icon files are drawn with. */
const ACCENT = builtInBrandColor;
const ACCENT_IN_SVG = new RegExp(ACCENT, "gi");

/** Whether a team's colour is the one the icons already have. */
export const isIconAccent = (color: string) => color.toLowerCase() === ACCENT;

/** An icon's SVG with the accent swapped for `color`. */
export const recolorIcon = (svg: string, color: string) => svg.replace(ACCENT_IN_SVG, color);

export const iconDataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

const sources = new Map<string, Promise<string | null>>();

/** An icon's SVG source, read once per address. Null for anything that isn't an SVG. */
export function loadIconSvg(url: string): Promise<string | null> {
  let source = sources.get(url);
  if (!source) {
    source = fetch(url)
      .then(async (response) => {
        const text = response.ok ? await response.text() : "";
        return text.includes("<svg") ? text : null;
      })
      .catch(() => null);
    sources.set(url, source);
  }
  return source;
}

/** An SVG as a PNG of `size` pixels (for the icons browsers only take as pictures). */
function toPng(svg: string, size: number): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, size, size);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = iconDataUrl(svg);
  });
}

/** One of the page's icon links, remembering the address it came with. */
function iconLink(selector: string): HTMLLinkElement | null {
  const link = document.head.querySelector<HTMLLinkElement>(selector);
  if (link && link.dataset.g3Icon === undefined)
    link.dataset.g3Icon = link.getAttribute("href") ?? "";
  return link;
}

/** The colour the tab's icons were last asked to be. */
let wanted = "";

/**
 * Puts the page's own icons (index.html's links: the tab's SVG, its .ico fallback and the
 * home-screen icon) in `color`. The fallback and home-screen icons are pictures, so they're drawn
 * from the recoloured SVG.
 */
export function applyTabIcons(color: string) {
  const key = color.toLowerCase();
  if (key === wanted) return;
  wanted = key;
  const svgLink = iconLink('link[rel="icon"][type="image/svg+xml"]');
  const icoLink = iconLink('link[rel="icon"]:not([type="image/svg+xml"])');
  const touchLink = iconLink('link[rel="apple-touch-icon"]');
  if (!svgLink) return;

  if (isIconAccent(color)) {
    for (const link of [svgLink, icoLink, touchLink]) {
      if (link?.dataset.g3Icon) link.href = link.dataset.g3Icon;
    }
    return;
  }
  void loadIconSvg(svgLink.dataset.g3Icon ?? "").then(async (svg) => {
    if (!svg || wanted !== key) return;
    const recolored = recolorIcon(svg, color);
    svgLink.href = iconDataUrl(recolored);
    const [small, large] = await Promise.all([
      icoLink ? toPng(recolored, 64) : null,
      touchLink ? toPng(recolored, 180) : null,
    ]);
    if (wanted !== key) return;
    if (icoLink && small) icoLink.href = small;
    if (touchLink && large) touchLink.href = large;
  });
}
