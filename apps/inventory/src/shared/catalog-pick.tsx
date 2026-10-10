import { useMemo, useState } from "react";
import { type CatalogPart, packOf, searchCatalog, useCatalog } from "./catalog";
import { ago, formatCents } from "./format";
import { inputClass } from "./ui";

/** A catalog part's vendor, part number and what was last paid, on one line. */
export function partLine(
  part: Pick<CatalogPart, "vendor" | "sku" | "priceCents" | "priceAt" | "packQuantity">,
) {
  return [
    part.vendor,
    part.sku,
    packOf(part) > 1 ? `pack of ${packOf(part)}` : null,
    part.priceCents === null
      ? null
      : `${formatCents(part.priceCents)} paid ${part.priceAt === null ? "" : ago(part.priceAt)}`.trim(),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Finds a part in Orders' catalog by name, vendor or part number. `taken` are catalog parts
 * already on an entry, which can't be picked again.
 */
export function CatalogPick({
  onPick,
  taken,
  initialQuery = "",
}: {
  onPick: (part: CatalogPart) => void;
  taken?: Map<number, string>;
  initialQuery?: string;
}) {
  const parts = useCatalog();
  const [query, setQuery] = useState(initialQuery);
  const found = useMemo(() => (parts ? searchCatalog(parts, query) : []), [parts, query]);

  if (parts === null) {
    return (
      <p className="text-sm text-secondary-500">
        The Orders catalog can't be reached. You can still type a listing in.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <input
        type="search"
        className={inputClass}
        placeholder="Search the Orders catalog: name, vendor or part number"
        aria-label="Search the Orders catalog"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {parts === undefined && <p className="text-sm text-secondary-400">Loading the catalog…</p>}
      {parts && query.trim() && found.length === 0 && (
        <p className="text-sm text-secondary-500">Nothing in the catalog matches.</p>
      )}
      {found.length > 0 && (
        <ul className="max-h-64 divide-y divide-secondary-100 overflow-y-auto rounded-lg border border-secondary-200">
          {found.map((part) => {
            const owner = taken?.get(part.id);
            return (
              <li key={part.id}>
                <button
                  type="button"
                  disabled={owner !== undefined}
                  onClick={() => onPick(part)}
                  className="block w-full px-3 py-2 text-left hover:bg-secondary-50 disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <span className="block text-sm text-secondary-900">{part.name}</span>
                  <span className="block text-xs text-secondary-500">
                    {partLine(part)}
                    {owner !== undefined && ` · already on “${owner}”`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
