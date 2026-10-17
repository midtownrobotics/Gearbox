import { type DocsPage, type DocsSection, pages, sections } from "virtual:gearbox-docs";

// The docs, as built from every app's docs folder (../../docs-plugin.ts).

export { pages, sections };
export type { DocsPage, DocsSection };

/** A page's path within the docs: /orders, /orders/setup. */
export const pagePath = (page: DocsPage) => `/${page.section}${page.slug ? `/${page.slug}` : ""}`;

export const pagesOf = (section: string) => pages.filter((p) => p.section === section);

export const findPage = (section: string, slug = "") =>
  pages.find((p) => p.section === section && p.slug === slug);

export const findSection = (id: string) => sections.find((s) => s.id === id);

/** Every page in reading order: section by section, each front page first. */
export const readingOrder: DocsPage[] = sections.flatMap((s) => pagesOf(s.id));

export type SearchResult = { page: DocsPage; snippet: string };

/** Pages with every word of the query, title matches first, each with a bit of text around a match. */
export function searchDocs(query: string): SearchResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const results: (SearchResult & { score: number })[] = [];
  for (const page of pages) {
    const title = page.title.toLowerCase();
    const text = `${page.summary} ${page.text}`;
    const lower = text.toLowerCase();
    if (!words.every((w) => title.includes(w) || lower.includes(w))) continue;
    const score = words.filter((w) => title.includes(w)).length * 10 + (page.slug === "" ? 1 : 0);
    const at = Math.max(0, Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0)));
    const start = Math.max(0, at - 60);
    const snippet = `${start > 0 ? "…" : ""}${text.slice(start, start + 180).trim()}…`;
    results.push({ page, snippet, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 30);
}
