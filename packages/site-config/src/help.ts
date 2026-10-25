// "Need help?" in the shared bar's menu: the docs page about the page you're on.
//
// Every docs file in an app's folder (`apps/<app>/docs/*.md`, other than index.md) names the app
// pages it's about in its front matter, as that app's route paths:
//   pages: /catalog /request /wishlist /lists/:id
// The first path with no `:name` part is the doc's main page: the one tutorial mode opens beside
// it when the reader turns to that doc in the panel (apps/platform/docs-plugin.ts, `appPathOf`).
// The app's build (`siteConfig()` in ./vite.ts) reads its own docs folder into `__G3_HELP__`, so
// the bar knows, for the page's path, which docs page to open; a page no doc names opens the app's
// front page in the docs (its index.md). The docs build (apps/platform/docs-plugin.ts) fails when a
// path isn't one of the app's routes, or two docs name the same one: **when an app's page moves
// to another address, change it in that doc's `pages` too.**
//
// No Node imports: this runs in the page, in Vite's config and in the docs build.

/** An app's docs, as its build gives them to the bar. */
export type HelpPages = {
  /** The app's section of the docs: its folder's name (/orders, /skill-tree). */
  section: string;
  /** Each route path a doc names, with that doc's slug (its file name without `.md`). */
  pages: [path: string, slug: string][];
};

/** A docs file's front matter and the Markdown after it. Throws when it has none, or no title. */
export function docsFrontMatter(source: string, file: string) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error(`${file}: starts without front matter (title, summary, order)`);
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^(\w+):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].trim();
  }
  if (!fields.title) throw new Error(`${file}: front matter has no title`);
  return { fields, body: source.slice(match[0].length) };
}

/** The route paths in a `pages:` line, as written. */
export const pagePaths = (value: string | undefined) =>
  (value ?? "").split(/[\s,]+/).filter(Boolean);

const segments = (path: string) => path.split("/").filter(Boolean);

/**
 * The slug of the doc about `pathname`, or null when none names it. A route path's `:name` part
 * matches any one part of the address; with several matches, the one with the most fixed parts
 * wins (/catalog/items/:id over /catalog/:anything).
 */
export function helpSlugFor(pathname: string, pages: HelpPages["pages"]): string | null {
  const here = segments(pathname);
  let best: { slug: string; fixed: number } | null = null;
  for (const [path, slug] of pages) {
    const route = segments(path);
    if (route.length !== here.length) continue;
    if (!route.every((part, i) => part.startsWith(":") || part === here[i])) continue;
    const fixed = route.filter((part) => !part.startsWith(":")).length;
    if (!best || fixed > best.fixed) best = { slug, fixed };
  }
  return best?.slug ?? null;
}

/**
 * Parts of an app a team can switch off, that a doc can be about (`feature:` in its front matter):
 * a tutorial panel's previous and next links skip the doc while the team has it off. Each is
 * checked in @g3/ui's tutorial.ts (`featureOn`).
 */
export const DOCS_FEATURES = ["scouting-points"] as const;
export type DocsFeature = (typeof DOCS_FEATURES)[number];
