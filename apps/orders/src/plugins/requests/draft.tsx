import { applyTemplate } from "@g3/worker-orders/naming";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { dateInputToMs, formatCents, formatDate, parseDollars } from "../../shared/format";
import { PRIORITY, PRIORITY_ORDER } from "../../shared/priority";
import { STATUS } from "../../shared/status-badge";
import type { CatalogItem, Priority } from "../../shared/types";
import { Button, Card, ErrorBanner, Field, Loading, inputClass } from "../../shared/ui";

// One item being filled in from a product link: New Request's rows, and a mentor's replacement
// item on the Approvals page.

type Lookup = InferResponseType<typeof api.lookup.$get, 200>;
type Suggestion = InferResponseType<typeof api.suggest.$post, 200>;

/** One item being requested. Several can be filled in at once from pasted links. */
export type Draft = {
  key: number;
  state: "loading" | "ready";
  /** Why the lookup failed, if it did (the row can still be filled in by hand). */
  lookupError: string | null;
  submitError: string | null;
  url: string;
  vendor: string;
  name: string;
  /** The product's own title, for re-applying the naming template when the option changes. */
  sourceTitle: string;
  nameEdited: boolean;
  sku: string;
  variant: string;
  variants: Lookup["variants"];
  image: string;
  price: string;
  priceUnit: string | null;
  currency: string;
  quantity: string;
  categoryId: string;
  categoryHint: string | null;
  priority: Priority;
  needBy: string;
  reason: string;
  history: Suggestion["history"];
  /** For one-click carts: the platform the lookup found and the store's id for the option. */
  storePlatform: string | null;
  storeVariantId: string | null;
  /** Picked from the catalog. */
  catalogItemId: number | null;
  /** The catalog's category: the known one, or the one the requester picks for a new part. */
  catalogCategory: string;
  /** The catalog already has this product, so no category needs picking. */
  catalogKnown: boolean;
  /** catalogCategory was guessed from the name's keywords and the requester hasn't changed it. */
  catalogCategoryGuessed: boolean;
  /** Why the link isn't a product page (a catalog item with only a vendor search or homepage). */
  linkNote: string | null;
};

let nextKey = 1;
export const blank = (url = ""): Draft => ({
  key: nextKey++,
  state: "ready",
  lookupError: null,
  submitError: null,
  url,
  vendor: "",
  name: "",
  sourceTitle: "",
  nameEdited: false,
  sku: "",
  variant: "",
  variants: [],
  image: "",
  price: "",
  priceUnit: null,
  currency: "USD",
  quantity: "1",
  categoryId: "",
  categoryHint: null,
  priority: "normal",
  needBy: "",
  reason: "",
  history: [],
  storePlatform: null,
  storeVariantId: null,
  catalogItemId: null,
  catalogCategory: "",
  catalogKnown: false,
  catalogCategoryGuessed: false,
  linkNote: null,
});

const dollars = (price: number | undefined) => (price === undefined ? "" : price.toFixed(2));
const HINTS = {
  history: "same as last time",
  vendor: "vendor's default",
  keyword: "keyword",
} as const;

/**
 * Looks up a product link and fills a draft from it: the lookup's details, the name from the team
 * template, a budget category guess and the product's purchase history. A failed lookup comes
 * back as `lookupError` with everything else blank, to fill in by hand.
 */
export async function lookUpDraft(url: string): Promise<Partial<Draft>> {
  let lookup: Lookup | null = null;
  let lookupError: string | null = null;
  try {
    const res = await api.lookup.$get({ query: { url } });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    lookup = await res.json();
  } catch (err) {
    lookupError = err instanceof Error ? err.message : String(err);
  }
  const selected = lookup?.variants.find((v) => v.id === lookup?.selectedVariantId);
  const variant = lookup && lookup.variants.length > 1 ? (selected?.title ?? "") : "";
  // A single-option product's only variant is the one to buy.
  const variantId = lookup?.variants.length === 1 ? lookup.variants[0].id : (selected?.id ?? null);
  const base = {
    url: lookup?.url ?? url,
    vendor: lookup?.vendor ?? "",
    sku: lookup?.sku ?? "",
    title: lookup?.title ?? "",
    variant,
  };
  const suggestion = await suggest(base);
  return {
    state: "ready",
    lookupError,
    url: base.url,
    vendor: suggestion?.vendor ?? base.vendor,
    name: lookup ? (suggestion?.name ?? lookup.title) : "",
    sourceTitle: base.title,
    sku: base.sku,
    variant,
    variants: lookup?.variants ?? [],
    image: lookup?.image ?? "",
    price: dollars(lookup?.price),
    priceUnit: lookup?.priceUnit ?? null,
    currency: lookup?.currency ?? "USD",
    ...suggestionFields(suggestion),
    storePlatform: lookup?.source ?? null,
    storeVariantId: variantId,
  };
}

/** The team's name, budget category guess, history and catalog category for a product. */
async function suggest(base: {
  url: string;
  vendor: string;
  sku: string;
  title: string;
  variant: string;
}): Promise<Suggestion | null> {
  try {
    const res = await api.suggest.$post({
      json: { ...base, sku: base.sku || null, variant: base.variant || null },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null; // Suggestions are a convenience; the row still works without them.
  }
}

function suggestionFields(suggestion: Suggestion | null): Partial<Draft> {
  return {
    categoryId: suggestion?.category ? String(suggestion.category.id) : "",
    categoryHint: suggestion?.category
      ? `${HINTS[suggestion.category.source]}${
          suggestion.category.detail ? ` (${suggestion.category.detail})` : ""
        }`
      : null,
    history: suggestion?.history ?? [],
    catalogCategory: suggestion?.catalogCategory ?? suggestion?.catalogCategoryGuess ?? "",
    catalogKnown: !!suggestion?.catalogCategory,
    catalogCategoryGuessed: !suggestion?.catalogCategory && !!suggestion?.catalogCategoryGuess,
  };
}

/** A price paid within this long is trusted; older ones are looked up again. */
const PRICE_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

export const priceIsFresh = (item: Pick<CatalogItem, "priceCents" | "priceAt">) =>
  item.priceCents !== null && item.priceAt !== null && Date.now() - item.priceAt < PRICE_FRESH_MS;

/**
 * A draft for a catalog item. A product link whose price wasn't paid in the last 7 days is
 * looked up again (current price, image, options); otherwise the catalog's details are used.
 */
export async function catalogDraft(item: CatalogItem): Promise<Partial<Draft>> {
  const fromCatalog: Partial<Draft> = {
    catalogItemId: item.id,
    catalogCategory: item.category,
    catalogKnown: true,
    catalogCategoryGuessed: false,
    linkNote:
      item.linkKind === "search"
        ? "This link is the vendor's search for the part number. Paste the product page if you find it."
        : item.linkKind === "homepage"
          ? "This link is only the vendor's homepage. Paste the product page if you find it."
          : null,
  };
  if (item.linkKind === "product" && !priceIsFresh(item)) {
    const found = await lookUpDraft(item.url);
    // The catalog's store option (REV links can't carry it the way Shopify's ?variant= does).
    const option = !found.variant
      ? found.variants?.find((v) => v.id === item.storeVariantId)
      : undefined;
    return {
      ...found,
      ...(option && (found.variants?.length ?? 0) > 1
        ? {
            variant: option.title,
            sku: option.sku ?? found.sku,
            price: dollars(option.price) || found.price,
          }
        : {}),
      ...fromCatalog,
      // A failed lookup still knows what the part is.
      lookupError: found.lookupError ? `${found.lookupError} Details are from the catalog.` : null,
      vendor: found.vendor || item.vendor,
      name: found.name || item.name,
      sourceTitle: found.sourceTitle || item.name,
      sku: option?.sku || found.sku || item.sku || "",
      image: found.image || item.image || "",
      storePlatform: found.storePlatform ?? item.storePlatform,
      storeVariantId: found.storeVariantId ?? item.storeVariantId,
    };
  }
  const suggestion = await suggest({
    url: item.url,
    vendor: item.vendor,
    sku: item.sku ?? "",
    title: item.name,
    variant: "",
  });
  return {
    state: "ready",
    lookupError: null,
    url: item.url,
    vendor: suggestion?.vendor ?? item.vendor,
    name: suggestion?.name ?? item.name,
    sourceTitle: item.name,
    sku: item.sku ?? "",
    image: item.image ?? "",
    price: priceIsFresh(item) ? ((item.priceCents as number) / 100).toFixed(2) : "",
    storePlatform: item.storePlatform,
    storeVariantId: item.storeVariantId,
    ...suggestionFields(suggestion),
    ...fromCatalog,
  };
}

/** The changes for picking one of the product's options: its price, SKU and the templated name. */
export function variantPatch(
  d: Draft,
  id: string,
  namingTemplate: string | undefined,
): Partial<Draft> | null {
  const v = d.variants.find((x) => x.id === id);
  if (!v) return null;
  const sku = v.sku ?? d.sku;
  return {
    variant: v.title,
    storeVariantId: v.id,
    sku,
    price: dollars(v.price) || d.price,
    ...(d.nameEdited || namingTemplate === undefined
      ? {}
      : {
          name: applyTemplate(namingTemplate, {
            vendor: d.vendor,
            sku: sku || null,
            title: d.sourceTitle,
            variant: v.title,
          }),
        }),
  };
}

/** What's missing before a draft can be sent, or null when it's complete. */
export function draftProblem(d: Draft, fallbackReason = ""): string | null {
  return (
    (!d.url && "Add the product link.") ||
    (!d.name.trim() && "Give it a name.") ||
    (Number.isNaN(parseDollars(d.price)) && "Price must be a dollar amount like 12.50.") ||
    (!(Number(d.quantity) >= 1) && "Quantity must be at least 1.") ||
    (!d.categoryId && "Pick a budget category.") ||
    (!d.catalogItemId &&
      !d.catalogCategory.trim() &&
      "This part is new to the catalog: pick a catalog category for it.") ||
    (!(d.reason.trim() || fallbackReason.trim()) && "Say why it's needed.") ||
    null
  );
}

/** The request fields a complete draft sends (create, or replace an existing request). */
export function draftFields(d: Draft, fallbackReason = "") {
  return {
    url: d.url,
    vendor: d.vendor,
    title: d.name.trim(),
    sku: d.sku || null,
    variant: d.variant || null,
    image: d.image || null,
    unitPriceCents: parseDollars(d.price),
    currency: d.currency,
    quantity: Number(d.quantity),
    categoryId: Number(d.categoryId),
    reason: d.reason.trim() || fallbackReason.trim(),
    priority: d.priority,
    needBy: dateInputToMs(d.needBy),
    storePlatform: d.storePlatform,
    storeVariantId: d.storeVariantId,
    catalogItemId: d.catalogItemId,
    catalogCategory: d.catalogCategory.trim() || null,
    // The catalog keeps the product's own name, not the team's templated one.
    catalogName: d.sourceTitle
      ? d.variant
        ? `${d.sourceTitle} (${d.variant})`
        : d.sourceTitle
      : null,
  };
}

export function DraftCard({
  draft: d,
  categories,
  onChange,
  onVariant,
  onRemove,
  removeLabel = "Remove",
  catalogCategories = [],
  onCategoryAdded,
}: {
  draft: Draft;
  categories: { id: number; name: string }[];
  /** The catalog's categories, offered when the part is new to the catalog. */
  catalogCategories?: string[];
  /** A category was just made here (reload the list). */
  onCategoryAdded?: (name: string) => void;
  onChange: (patch: Partial<Draft>) => void;
  onVariant: (id: string) => void;
  onRemove: () => void;
  removeLabel?: string;
}) {
  if (d.state === "loading") {
    return (
      <Card className="!p-4">
        <div className="flex min-w-0 items-center gap-3 text-sm text-secondary-500">
          <Loading />
          <span className="truncate">{d.url}</span>
        </div>
      </Card>
    );
  }
  const unit = parseDollars(d.price);
  const total =
    unit !== null && !Number.isNaN(unit) && Number(d.quantity) > 0
      ? unit * Number(d.quantity)
      : null;

  return (
    <Card className="!p-4">
      <div className="flex gap-4">
        {d.image ? (
          <img
            src={d.image}
            alt=""
            className="hidden sm:block w-24 h-24 object-contain rounded-lg bg-secondary-50 shrink-0"
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-start gap-2">
            <input
              className={`${inputClass} font-semibold`}
              value={d.name}
              onChange={(e) => onChange({ name: e.target.value, nameEdited: true })}
              placeholder="Item name"
              aria-label="Item name"
              maxLength={300}
            />
            <button
              type="button"
              onClick={onRemove}
              className="shrink-0 rounded-lg px-2 py-2 text-secondary-400 hover:text-primary-600"
              aria-label={removeLabel}
              title={removeLabel}
            >
              ✕
            </button>
          </div>
          {d.lookupError && (
            <p className="text-xs text-primary-700">{d.lookupError} Fill in the details by hand.</p>
          )}
          {d.linkNote && <p className="text-xs text-secondary-600">{d.linkNote}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2">
              <Field label="Link">
                <input
                  type="url"
                  className={inputClass}
                  value={d.url}
                  onChange={(e) => onChange({ url: e.target.value })}
                  placeholder="https://…"
                />
              </Field>
            </div>
            <Field label="Vendor">
              <input
                className={inputClass}
                value={d.vendor}
                onChange={(e) => onChange({ vendor: e.target.value })}
                placeholder="From the link"
              />
            </Field>
            <Field label="SKU">
              <input
                className={inputClass}
                value={d.sku}
                onChange={(e) => onChange({ sku: e.target.value })}
              />
            </Field>
            {d.variants.length > 1 && (
              <div className="col-span-2">
                <Field label="Option">
                  <select
                    className={inputClass}
                    value={d.variants.find((v) => v.title === d.variant)?.id ?? ""}
                    onChange={(e) => onVariant(e.target.value)}
                  >
                    <option value="" disabled>
                      Pick one…
                    </option>
                    {d.variants.map((v) => (
                      <option key={v.id} value={v.id} disabled={v.available === false}>
                        {v.title}
                        {v.price !== undefined
                          ? ` — ${formatCents(Math.round(v.price * 100), d.currency)}`
                          : ""}
                        {v.available === false ? " (out of stock)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
            <Field label="Each $" hint={d.priceUnit ? `Per ${d.priceUnit}` : undefined}>
              <input
                className={inputClass}
                inputMode="decimal"
                value={d.price}
                onChange={(e) => onChange({ price: e.target.value })}
                placeholder="0.00"
              />
            </Field>
            <Field
              label="Qty"
              hint={total !== null ? `= ${formatCents(total, d.currency)}` : undefined}
            >
              <input
                type="number"
                min={1}
                className={inputClass}
                value={d.quantity}
                onChange={(e) => onChange({ quantity: e.target.value })}
              />
            </Field>
            <div className="col-span-2">
              <Field
                label="Budget category"
                hint={
                  d.categoryHint
                    ? `Guessed (${d.categoryHint}). Check it's right and change it if not.`
                    : undefined
                }
                warn={!!d.categoryHint}
              >
                <select
                  className={inputClass}
                  value={d.categoryId}
                  onChange={(e) => onChange({ categoryId: e.target.value, categoryHint: null })}
                >
                  <option value="" disabled>
                    Pick one…
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Priority">
              <select
                className={inputClass}
                value={d.priority}
                onChange={(e) => onChange({ priority: e.target.value as Priority })}
              >
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY[p].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Need by">
              <input
                type="date"
                className={inputClass}
                value={d.needBy}
                onChange={(e) => onChange({ needBy: e.target.value })}
              />
            </Field>
            {!d.catalogItemId && !d.catalogKnown && (
              <div className="col-span-2">
                <Field
                  label="Catalog category"
                  hint={
                    d.catalogCategoryGuessed
                      ? "Guessed from the name. Check it's right and change it if not."
                      : "New to the catalog: where should others find it?"
                  }
                  warn={d.catalogCategoryGuessed}
                >
                  <CatalogCategoryPicker
                    value={d.catalogCategory}
                    categories={catalogCategories}
                    onChange={(catalogCategory) =>
                      onChange({ catalogCategory, catalogCategoryGuessed: false })
                    }
                    onAdded={onCategoryAdded}
                  />
                </Field>
              </div>
            )}
            <div className="col-span-2 sm:col-span-4">
              <Field label="Why do we need it?">
                <input
                  className={inputClass}
                  value={d.reason}
                  onChange={(e) => onChange({ reason: e.target.value })}
                  placeholder="What it's for, and anything a mentor should know"
                  maxLength={1000}
                />
              </Field>
            </div>
          </div>
          {d.history.length > 0 && (
            <details
              className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm"
              open
            >
              <summary className="cursor-pointer font-semibold text-amber-900">
                Bought before ({d.history.length})
              </summary>
              <ul className="mt-1 space-y-0.5 text-secondary-700">
                {d.history.map((h) => (
                  <li key={h.id}>
                    <Link to={`/requests/${h.id}`} className="hover:text-primary-500">
                      {formatDate(h.createdAt)} · {h.quantity} × {formatCents(h.unitPriceCents)} ·{" "}
                      {STATUS[h.status].label} · {h.requesterName}
                      {h.categoryName ? ` · ${h.categoryName}` : ""}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {d.submitError && <ErrorBanner message={d.submitError} />}
        </div>
      </div>
    </Card>
  );
}

const NEW_CATEGORY = "\u0000new";

/**
 * The catalog category for a part new to the catalog. Mentors and trusted students can also
 * make a new category right here.
 */
function CatalogCategoryPicker({
  value,
  categories,
  onChange,
  onAdded,
}: {
  value: string;
  categories: string[];
  onChange: (name: string) => void;
  onAdded?: (name: string) => void;
}) {
  const { canEditCatalog } = useAuthUser();
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const name = (adding ?? "").trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const res = await api.catalog.categories.$post({ json: { name } });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    onAdded?.(name);
    onChange(name);
    setAdding(null);
  }

  if (adding !== null) {
    return (
      <div className="space-y-1">
        <div className="flex gap-2">
          <input
            className={`${inputClass} min-w-0 flex-1`}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            placeholder="New category name"
            maxLength={100}
            aria-label="New category name"
            // biome-ignore lint/a11y/noAutofocus: opened by choosing "New category"
            autoFocus
          />
          <Button onClick={add} disabled={busy || !adding.trim()} className="!py-1.5">
            {busy ? "…" : "Add"}
          </Button>
          <Button variant="secondary" onClick={() => setAdding(null)} className="!py-1.5">
            Cancel
          </Button>
        </div>
        {error && <p className="text-xs text-primary-700">{error}</p>}
      </div>
    );
  }
  // A category made here shows even before the list reloads.
  const list = value && !categories.includes(value) ? [...categories, value].sort() : categories;
  return (
    <select
      className={inputClass}
      value={value}
      onChange={(e) => (e.target.value === NEW_CATEGORY ? setAdding("") : onChange(e.target.value))}
    >
      <option value="" disabled>
        Pick one…
      </option>
      {list.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      {canEditCatalog && <option value={NEW_CATEGORY}>+ New category…</option>}
    </select>
  );
}
