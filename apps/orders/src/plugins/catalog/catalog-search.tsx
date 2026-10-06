import { useEffect, useMemo, useRef, useState } from "react";
import { formatCents } from "../../shared/format";
import type { CatalogItem } from "../../shared/types";
import { inputClass } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { type LoadedCatalog, loadCatalog } from "./catalog-data";
import { searchIds } from "./search";

const SHOWN = 8;

/**
 * A small catalog search: type loosely ("1/2 hex bearing"), pick a part from the best matches.
 * Arrow keys move, Enter picks, Esc closes. Any page can use it; the catalog loads once.
 */
export function CatalogSearch({
  onPick,
  placeholder = "Search the catalog…",
  autoFocus = false,
}: {
  onPick: (item: CatalogItem) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const catalog = useLoad(loadCatalog, []);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const results = useMemo(() => matches(catalog.data, query), [catalog.data, query]);
  // Clicking elsewhere closes the list.
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (item: CatalogItem) => {
    onPick(item);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <input
        type="search"
        className={inputClass}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        aria-label="Search the catalog"
        // biome-ignore lint/a11y/noAutofocus: callers turn it on where search is the next step
        autoFocus={autoFocus}
      />
      {open && query.trim() && (
        <ul className="absolute z-30 mt-1 w-full max-h-80 overflow-y-auto rounded-lg border border-secondary-200 bg-white shadow-lg">
          {catalog.error ? (
            <li className="px-3 py-2 text-sm text-primary-700">{catalog.error}</li>
          ) : !catalog.data ? (
            <li className="px-3 py-2 text-sm text-secondary-500">Loading the catalog…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-secondary-500">No parts match.</li>
          ) : (
            results.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(item)}
                  className={`w-full px-3 py-2 text-left ${i === active ? "bg-secondary-100" : ""}`}
                >
                  <span className="block text-sm text-secondary-900">{item.name}</span>
                  <span className="block text-xs text-secondary-500">
                    {item.vendor}
                    {item.sku && ` · ${item.sku}`} · {item.category}
                    {item.priceCents !== null && ` · ${formatCents(item.priceCents)}`}
                    {item.linkKind !== "product" && " · no product link"}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function matches(catalog: LoadedCatalog | null, query: string): CatalogItem[] {
  if (!catalog || !query.trim()) return [];
  return searchIds(catalog.index, query)
    .slice(0, SHOWN)
    .map((id) => catalog.byId.get(id) as CatalogItem);
}
