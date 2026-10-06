import { api, getErrorMessage } from "../../shared/api";
import type { CatalogData, CatalogFamily, CatalogItem } from "../../shared/types";
import { type CatalogIndex, buildIndex } from "./search";

export type LoadedCatalog = Omit<CatalogData, "families"> & {
  index: CatalogIndex;
  byId: Map<number, CatalogItem>;
  families: Map<number, CatalogFamily>;
};

/** How long a loaded catalog is reused before the next search box fetches it again. */
const FRESH_MS = 5 * 60_000;
let cached: { at: number; promise: Promise<LoadedCatalog> } | null = null;

/** The whole catalog with its search index, shared by every search box on the page. */
export function loadCatalog(): Promise<LoadedCatalog> {
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.promise;
  const promise = (async () => {
    const res = await api.catalog.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    const data = await res.json();
    const families = new Map(data.families.map((f) => [f.id, f]));
    return {
      ...data,
      families,
      byId: new Map(data.items.map((i) => [i.id, i])),
      index: buildIndex(data.items, families),
    };
  })();
  cached = { at: Date.now(), promise };
  promise.catch(() => {
    cached = null; // A failed load is retried by the next search box.
  });
  return promise;
}

/** After the catalog changes, the next search box loads it fresh. */
export function invalidateCatalog() {
  cached = null;
}
