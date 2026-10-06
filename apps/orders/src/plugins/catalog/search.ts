import MiniSearch from "minisearch";
import type { CatalogFamily, CatalogItem } from "../../shared/types";

// Fuzzy search over the whole catalog, in the browser. Part names are full of sizes written many
// ways ('1/2"', '.5 in', '0.500"', '#10-32', '1x1', '13.75mm'), so names and queries both go
// through the same normalizing before matching: fractions become decimals, trailing zeros and
// quote marks go, units split from numbers. Typos are allowed in words, not in numbers.

const STOP_WORDS = new Set(["x", "in", "the", "for", "with", "and", "of", "a", "to"]);

const decimal = (n: number) => String(Number(n.toFixed(4)));

/** Text in the form both names and queries are matched in. */
export function normalize(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[″”“]/g, '"')
      .replace(/[’‘]/g, "'")
      // 1-1/2 and 1 1/2 → 1.5
      .replace(/\b(\d+)[- ](\d+)\/(\d+)\b/g, (m, w, n, d) =>
        Number(d) ? decimal(Number(w) + Number(n) / Number(d)) : m,
      )
      // 3/4 → 0.75
      .replace(/\b(\d+)\/(\d+)\b/g, (m, n, d) => (Number(d) ? decimal(Number(n) / Number(d)) : m))
      // .5 → 0.5
      .replace(/(^|[^\d.])\.(\d)/g, "$10.$2")
      // 1x1, 16T, 13.75mm → 1 x 1, 16 t, 13.75 mm
      .replace(/(\d)\s*x\s*(?=[\d.])/g, "$1 x ")
      .replace(/(\d)(mm|cm|in|ft|t|lb|lbs|oz|v|a|w|kg|g)\b/g, "$1 $2")
      // 1 inch = 1"
      .replace(/\b(inch|inches)\b/g, '"')
      // "16 tooth" is how people say 16t
      .replace(/\b(tooth|teeth)\b/g, "t")
  );
}

/** Words of normalized text: hyphenated ones (10-32, wcp-2073) also as their parts. */
export function tokenize(text: string): string[] {
  const words = normalize(text)
    .split(/[\s,;:()[\]{}"'#|+/*]+/)
    .map((w) => w.replace(/^[-.]+|[-.]+$/g, ""))
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    out.push(w);
    if (w.includes("-")) out.push(...w.split("-").filter(Boolean), w.replace(/-/g, ""));
  }
  return out;
}

export const isNumber = (term: string) => /^\d*\.?\d+$/.test(term);

export function processTerm(term: string): string | null {
  if (STOP_WORDS.has(term)) return null;
  // 0.500 and 0.5 are the same size.
  return isNumber(term) ? decimal(Number(term)) : term;
}

/** Other words people use for what part names abbreviate. */
const ALIASES: [RegExp, string][] = [
  [/\bbhcs\b/i, "button head cap screw bolt"],
  [/\bshcs\b/i, "socket head cap screw bolt"],
  [/\bfhcs\b/i, "flat head countersunk screw bolt"],
  [/\bscrew\b/i, "bolt"],
  [/\bnut\b/i, "nyloc locknut"],
  [/\bstandoff\b/i, "spacer"],
  [/\bbearing\b/i, "bearings"],
];

const aliasesOf = (text: string) =>
  ALIASES.filter(([re]) => re.test(text))
    .map(([, words]) => words)
    .join(" ");

type Doc = {
  id: number;
  aliases: string;
  name: string;
  family: string;
  sku: string;
  vendor: string;
  category: string;
  options: string;
};

export type CatalogIndex = MiniSearch<Doc>;

export function buildIndex(items: CatalogItem[], families: Map<number, CatalogFamily>) {
  const index = new MiniSearch<Doc>({
    fields: ["name", "family", "sku", "vendor", "category", "options", "aliases"],
    tokenize,
    processTerm,
    searchOptions: {
      boost: { sku: 3, name: 2, family: 1.5, aliases: 0.7 },
      prefix: (term) => !isNumber(term),
      // One typo in short words, two in long ones ("bearnig" swaps two letters).
      fuzzy: (term) => (isNumber(term) || term.length < 4 ? false : term.length < 6 ? 0.25 : 0.34),
    },
  });
  index.addAll(
    items.map((i) => ({
      id: i.id,
      aliases: aliasesOf(
        `${i.name} ${(i.familyId !== null && families.get(i.familyId)?.name) || ""}`,
      ),
      name: i.name,
      family: (i.familyId !== null && families.get(i.familyId)?.name) || "",
      sku: i.sku ?? "",
      vendor: i.vendor,
      category: i.category,
      options: Object.entries(i.options)
        .map(([k, v]) => `${k} ${v}`)
        .join(" "),
    })),
  );
  return index;
}

/**
 * Item ids matching the query, best first: every word must match; when nothing does, the items
 * matching the most words.
 */
export function searchIds(index: CatalogIndex, query: string): number[] {
  const all = index.search(query, { combineWith: "AND" });
  const results = all.length > 0 ? all : index.search(query, { combineWith: "OR" });
  return results.map((r) => r.id as number);
}
