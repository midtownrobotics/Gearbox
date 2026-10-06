import MiniSearch from "minisearch";
import { PRIORITY } from "../../shared/priority";
import { STATUS } from "../../shared/status-badge";
import type { OrderRequest, PartList } from "../../shared/types";
import { isNumber, processTerm, tokenize } from "../catalog/search";

// Fuzzy find over a list's requests and over the lists themselves, with the catalog's matching:
// sizes written any way ('1/2"' finds '0.5 in'), prefixes ("bear" finds "bearing") and typos in
// words, not numbers. Every word typed must match something.

const SEARCH_OPTIONS = {
  prefix: (term: string) => !isNumber(term),
  fuzzy: (term: string) =>
    isNumber(term) || term.length < 4 ? false : term.length < 6 ? 0.25 : 0.34,
  combineWith: "AND" as const,
};

type RequestDoc = {
  id: number;
  title: string;
  sku: string;
  vendor: string;
  variant: string;
  category: string;
  people: string;
  reason: string;
  status: string;
};

/** A search over requests; `find` returns the matching ones, best first (all of them when empty). */
export function requestSearch<T extends OrderRequest>(requests: T[]) {
  const index = new MiniSearch<RequestDoc>({
    fields: ["title", "sku", "vendor", "variant", "category", "people", "reason", "status"],
    tokenize,
    processTerm,
    searchOptions: {
      ...SEARCH_OPTIONS,
      boost: { sku: 3, title: 2, vendor: 1.5, reason: 0.5 },
    },
  });
  index.addAll(
    requests.map((r) => ({
      id: r.id,
      title: r.title,
      sku: r.sku ?? "",
      vendor: r.vendor,
      variant: r.variant ?? "",
      category: r.categoryName,
      people: r.requesterName,
      reason: r.reason,
      status: `${STATUS[r.status].label} ${r.status} ${PRIORITY[r.priority].label} #${r.id}`,
    })),
  );
  const byId = new Map(requests.map((r) => [r.id, r]));
  return (query: string): T[] =>
    query.trim() ? index.search(query).map((hit) => byId.get(hit.id as number) as T) : requests;
}

/** A search over lists by name, description and who made them. */
export function listSearch(lists: PartList[]) {
  const index = new MiniSearch<{ id: number; name: string; description: string; by: string }>({
    fields: ["name", "description", "by"],
    tokenize,
    processTerm,
    searchOptions: { ...SEARCH_OPTIONS, boost: { name: 3 } },
  });
  index.addAll(
    lists.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description ?? "",
      by: l.createdByName,
    })),
  );
  const byId = new Map(lists.map((l) => [l.id, l]));
  return (query: string): PartList[] =>
    query.trim() ? index.search(query).map((hit) => byId.get(hit.id as number) as PartList) : lists;
}
