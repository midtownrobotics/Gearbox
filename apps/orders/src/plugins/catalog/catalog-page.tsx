import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { formatCents } from "../../shared/format";
import type { CatalogFamily, CatalogItem } from "../../shared/types";
import { Button, Card, ErrorBanner, Loading, Page, inputClass } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { priceIsFresh } from "../requests/draft";
import { invalidateCatalog } from "./catalog-data";
import { ItemEditor } from "./item-editor";
import { buildIndex, searchIds } from "./search";

const PAGE = 30;

type Group = { key: string; family: CatalogFamily | null; items: CatalogItem[] };

/**
 * The parts catalog, like a store: search loosely ("1/2 hex bearing", "10-32 button 3/4"),
 * narrow by category and vendor, pick a family's size and type, and request the part.
 * Anyone can add, fix or delete parts; links people request join the catalog on their own.
 */
export function CatalogPage() {
  const {
    data,
    error,
    reload: load,
  } = useLoad(async () => {
    const res = await api.catalog.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  // Search boxes elsewhere share a loaded copy; after a change here they load it fresh.
  const reload = () => {
    invalidateCatalog();
    load();
  };
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [vendor, setVendor] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState(false);
  const { canEditCatalog } = useAuthUser();
  // Opened from a list (?list=…): parts requested from here go on it.
  const [params] = useSearchParams();
  const fromList = useLoad(async () => {
    const id = params.get("list");
    if (!id) return null;
    const res = await api.lists[":id"].$get({ param: { id } });
    return res.ok ? res.json() : null;
  }, [params.get("list")]);

  // Back to the first page of results whenever the search changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on these changes only
  useEffect(() => setLimit(PAGE), [query, category, vendor]);

  const families = useMemo(
    () => new Map((data?.families ?? []).map((f) => [f.id, f])),
    [data?.families],
  );
  const byId = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i])), [data?.items]);
  const index = useMemo(() => (data ? buildIndex(data.items, families) : null), [data, families]);

  // Matches for the search (before the category filter, which shows counts over them).
  const matches = useMemo(() => {
    if (!data || !index) return [];
    const found = query.trim()
      ? searchIds(index, query).map((id) => byId.get(id) as CatalogItem)
      : [...data.items].sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            familyName(a, families).localeCompare(familyName(b, families)) ||
            a.name.localeCompare(b.name),
        );
    return vendor ? found.filter((i) => i.vendor === vendor) : found;
  }, [data, index, query, vendor, byId, families]);

  const counts = useMemo(() => {
    const n = new Map<string, number>();
    for (const i of matches) n.set(i.category, (n.get(i.category) ?? 0) + 1);
    return n;
  }, [matches]);

  // One card per family (or per item for parts added by requests), best match first.
  const groups = useMemo(() => {
    const out = new Map<string, Group>();
    for (const item of matches) {
      if (category && item.category !== category) continue;
      const key = item.familyId !== null ? `f${item.familyId}` : `i${item.id}`;
      const group = out.get(key) ?? {
        key,
        family: item.familyId !== null ? (families.get(item.familyId) ?? null) : null,
        items: [],
      };
      group.items.push(item);
      out.set(key, group);
    }
    return [...out.values()];
  }, [matches, category, families]);

  const vendors = useMemo(
    () => [...new Set((data?.items ?? []).map((i) => i.vendor))].sort(),
    [data?.items],
  );

  return (
    <Page
      title="Catalog"
      actions={
        canEditCatalog && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setNewCategory(true)}>
              New category
            </Button>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add part
            </Button>
          </div>
        )
      }
    >
      {fromList.data && (
        <p className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-4 py-2.5">
          Parts you request from here go on <strong>{fromList.data.name}</strong>.{" "}
          <Link to={`/lists/${fromList.data.id}`} className="underline">
            Back to the list
          </Link>
        </p>
      )}
      {error && <ErrorBanner message={error} />}
      {newCategory && (
        <NewCategory
          onDone={(name) => {
            setNewCategory(false);
            if (name) reload();
          }}
        />
      )}
      {adding && data && (
        <ItemEditor
          categories={data.categories}
          onDone={(saved) => {
            setAdding(false);
            if (saved) reload();
          }}
        />
      )}
      <div className="space-y-3">
        <input
          type="search"
          className={`${inputClass} !text-base`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search parts: "1/2 hex bearing", "10-32 button head 3/4", "WCP-0320", "neo"…'
          aria-label="Search the catalog"
          // biome-ignore lint/a11y/noAutofocus: the page is for searching
          autoFocus
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={`${inputClass} !w-auto !py-1.5 text-sm`}
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            aria-label="Vendor"
          >
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <Chip active={category === null} onClick={() => setCategory(null)}>
            All · {matches.length}
          </Chip>
          {(data?.categories ?? [])
            .filter((cat) => counts.has(cat))
            .map((cat) => (
              <Chip
                key={cat}
                active={category === cat}
                onClick={() => setCategory(category === cat ? null : cat)}
              >
                {cat} · {counts.get(cat)}
              </Chip>
            ))}
        </div>
      </div>

      {!data ? (
        <Loading />
      ) : groups.length === 0 ? (
        <p className="text-sm text-secondary-500">
          Nothing matches. Try fewer words
          {canEditCatalog ? ", or add the part with “Add part”" : ""}.
        </p>
      ) : (
        <div className="space-y-2">
          {groups.slice(0, limit).map((g) => (
            <FamilyCard
              key={g.key}
              group={g}
              open={groups.length <= 3}
              categories={data.categories}
              onChanged={reload}
            />
          ))}
          {groups.length > limit && (
            <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
              Show more ({groups.length - limit} more)
            </Button>
          )}
        </div>
      )}
    </Page>
  );
}

const familyName = (item: CatalogItem, families: Map<number, CatalogFamily>) =>
  (item.familyId !== null && families.get(item.familyId)?.name) || item.name;

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm font-medium ${
        active
          ? "bg-secondary-900 text-white border-secondary-900"
          : "bg-white text-secondary-600 border-secondary-300 hover:border-secondary-500"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * A family as a store product: its sizes and types as dropdowns (only the choices that vary),
 * and the matching parts to request.
 */
function FamilyCard({
  group,
  open: startOpen,
  categories,
  onChanged,
}: {
  group: Group;
  open: boolean;
  categories: string[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setOpen(startOpen), [startOpen]);

  const { items, family } = group;
  const first = items[0];
  const title = family?.name ?? first.name;
  const vendors = [...new Set(items.map((i) => i.vendor))];
  const prices = items.filter((i) => i.priceCents !== null).map((i) => i.priceCents as number);
  const image = items.find((i) => i.image)?.image;

  // Options that differ between these parts, each with its values in the order seen.
  const optionKeys = useMemo(() => {
    const values = new Map<string, Set<string>>();
    for (const i of items) {
      for (const [k, v] of Object.entries(i.options)) {
        values.set(k, (values.get(k) ?? new Set()).add(v));
      }
    }
    return [...values].filter(([, v]) => v.size > 1).map(([k, v]) => ({ key: k, values: [...v] }));
  }, [items]);
  const shown = items.filter((i) =>
    Object.entries(choice).every(([k, v]) => !v || i.options[k] === v),
  );
  const rows = showAll ? shown : shown.slice(0, 20);
  const single = items.length === 1;

  return (
    <Card className="!p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary-50"
        aria-expanded={open}
      >
        {image ? (
          <img
            src={image}
            alt=""
            className="w-12 h-12 object-contain rounded-md bg-secondary-50 shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-md bg-secondary-100 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-secondary-900 line-clamp-2">{title}</p>
          <p className="text-xs text-secondary-500">
            {first.category} · {vendors.join(", ")}
            {!single && ` · ${items.length} options`}
            {prices.length > 0 &&
              ` · ${formatCents(Math.min(...prices))}${
                Math.max(...prices) !== Math.min(...prices)
                  ? `–${formatCents(Math.max(...prices))}`
                  : ""
              }`}
          </p>
        </div>
        <span className="text-secondary-400 text-sm shrink-0">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="border-t border-secondary-200 px-4 py-3 space-y-3">
          {optionKeys.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {optionKeys.map(({ key, values }) => (
                <label key={key} className="text-xs text-secondary-500 space-y-1">
                  <span className="block">{key}</span>
                  <select
                    className={`${inputClass} !w-auto max-w-72 !py-1.5 text-sm`}
                    value={choice[key] ?? ""}
                    onChange={(e) => setChoice({ ...choice, [key]: e.target.value })}
                  >
                    <option value="">Any</option>
                    {values.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          <ul className="divide-y divide-secondary-100">
            {rows.map((item) => (
              <ItemRow key={item.id} item={item} categories={categories} onChanged={onChanged} />
            ))}
          </ul>
          {shown.length === 0 && (
            <p className="text-sm text-secondary-500">No part has all of those choices.</p>
          )}
          {!showAll && shown.length > rows.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-sm underline text-secondary-600"
            >
              Show all {shown.length}
            </button>
          )}
          {family?.sourceUrl && (
            <a
              href={family.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-secondary-400 hover:text-secondary-700"
            >
              CAD in the FRCDesign library ↗
            </a>
          )}
        </div>
      )}
    </Card>
  );
}

const LINK_LABEL = {
  product: "Product page ↗",
  search: "Vendor search ↗",
  homepage: "Vendor site ↗",
};

function ago(ms: number) {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

function ItemRow({
  item,
  categories,
  onChanged,
}: {
  item: CatalogItem;
  categories: string[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { canEditCatalog } = useAuthUser();
  const [params] = useSearchParams();
  const listId = params.get("list");
  if (editing) {
    return (
      <li className="py-2">
        <ItemEditor
          item={item}
          categories={categories}
          onDone={(saved) => {
            setEditing(false);
            if (saved) onChanged();
          }}
        />
      </li>
    );
  }
  return (
    <li className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm text-secondary-900">{item.name}</p>
        <p className="text-xs text-secondary-500">
          {item.vendor}
          {item.sku && ` · ${item.sku}`}
          {" · "}
          {item.priceCents === null ? (
            "no price yet"
          ) : (
            <span
              className={priceIsFresh(item) ? "text-secondary-700" : "text-secondary-400"}
              title={
                priceIsFresh(item)
                  ? "What we paid last time"
                  : "Paid more than 7 days ago: requesting it looks the price up again"
              }
            >
              {formatCents(item.priceCents)} paid {ago(item.priceAt as number)}
            </span>
          )}
          {item.requestCount > 0 &&
            ` · requested ${item.requestCount} time${item.requestCount === 1 ? "" : "s"}`}
        </p>
      </div>
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-secondary-500 hover:text-primary-600 whitespace-nowrap"
      >
        {LINK_LABEL[item.linkKind]}
      </a>
      {canEditCatalog && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-secondary-500 hover:text-secondary-900"
        >
          Edit
        </button>
      )}
      <Link
        to={`/new?catalog=${item.id}${listId ? `&list=${listId}` : ""}`}
        className="rounded-lg bg-primary-500 px-3 py-1 text-sm font-semibold text-white hover:bg-primary-600"
      >
        Request
      </Link>
    </li>
  );
}

/** A new catalog category (mentors and trusted students). */
function NewCategory({ onDone }: { onDone: (name: string | null) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api.catalog.categories.$post({ json: { name: name.trim() } });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    onDone(name.trim());
  }

  return (
    <Card title="New category" className="!p-4">
      <form onSubmit={save} className="flex flex-wrap gap-2">
        <input
          className={`${inputClass} min-w-0 flex-1`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Pneumatics"
          maxLength={100}
          aria-label="Category name"
          // biome-ignore lint/a11y/noAutofocus: opened by clicking "New category"
          autoFocus
        />
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Adding…" : "Add category"}
        </Button>
        <Button variant="secondary" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </form>
      {error && <ErrorBanner message={error} />}
    </Card>
  );
}
