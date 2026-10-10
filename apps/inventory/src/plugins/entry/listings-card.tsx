import type { ItemView, ListingView } from "@g3/worker-inventory";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import {
  type CatalogPart,
  LINK_LABEL,
  catalogPartFor,
  packOf,
  partPriceCents,
  requestUrl,
  useCatalog,
  useOrdersOn,
} from "../../shared/catalog";
import { CatalogPick } from "../../shared/catalog-pick";
import { ago, formatCents } from "../../shared/format";
import { useInventory } from "../../shared/inventory-data";
import { locationLabel, useLabel } from "../../shared/places";
import { Button, Card, Dialog, ErrorBanner, Field, inputClass } from "../../shared/ui";
import { useTakenParts } from "../table/new-entry-page";

// The ways to buy an entry: one panel per vendor's listing. Equivalent parts from different
// vendors are several listings on one entry. A listing that's in Orders' catalog shows what the
// catalog knows now (its product page, what was last paid) and can be requested from here.

const smallLink = "text-xs text-secondary-500 hover:text-primary-600 whitespace-nowrap";

function ListingPanel({
  item,
  listing,
  part,
  onChanged,
  onSplit,
}: {
  item: ItemView;
  listing: ListingView;
  part: CatalogPart | null;
  onChanged: () => Promise<void>;
  onSplit: () => void;
}) {
  const { isMentor } = useAuthUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What Orders knows now wins over the copy saved with the listing. Both are for one part.
  const pack = part ? packOf(part) : 1;
  const priceCents = (part && partPriceCents(part)) ?? listing.priceCents;
  const priceAt = part?.priceCents != null ? part.priceAt : listing.priceAt;
  const url = part?.url ?? listing.url;
  const title =
    listing.name || part?.name || [listing.vendor, listing.sku].filter(Boolean).join(" ");

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await api.items[":id"].listings[":listingId"].$delete({
      param: { id: String(item.id), listingId: String(listing.id) },
    });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    await onChanged();
  }

  return (
    <li className="rounded-lg border border-secondary-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-sm font-semibold text-secondary-900">{title}</p>
          <p className="text-xs text-secondary-500">
            {[listing.vendor || part?.vendor, listing.sku ?? part?.sku].filter(Boolean).join(" · ")}
            {part && (
              <span className="ml-2 rounded-full bg-secondary-100 px-2 py-0.5 font-semibold text-secondary-600">
                In the Orders catalog
              </span>
            )}
          </p>
          <p className="mt-1.5 text-sm text-secondary-700">
            {priceCents === null ? (
              <span className="text-secondary-400">No price yet</span>
            ) : (
              <>
                <span className="font-semibold">{formatCents(priceCents)}</span> each
                {part && pack > 1 && ` (${formatCents(part.priceCents)} for a pack of ${pack})`}
                {priceAt !== null && `, paid ${ago(priceAt)}`}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className={smallLink}>
              {part ? LINK_LABEL[part.linkKind] : "Product page ↗"}
            </a>
          )}
          {part && (
            <a
              href={requestUrl(part)}
              className="rounded-lg bg-primary-500 px-3 py-1 text-sm font-semibold text-white hover:bg-primary-600"
            >
              Request
            </a>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 border-t border-secondary-100 pt-2">
        {isMentor && item.listings.length > 1 && (
          <button type="button" className={smallLink} onClick={onSplit}>
            Split off as its own entry…
          </button>
        )}
        <button type="button" className={smallLink} disabled={busy} onClick={() => void remove()}>
          {busy ? "Removing…" : "Remove listing"}
        </button>
      </div>
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
    </li>
  );
}

/** Adds a listing: a part picked from Orders' catalog, or a vendor's page typed in. */
function AddListingDialog({
  item,
  onClose,
  onChanged,
}: { item: ItemView; onClose: () => void; onChanged: () => Promise<void> }) {
  const taken = useTakenParts();
  const ordersOn = useOrdersOn();
  const [vendor, setVendor] = useState("");
  const [sku, setSku] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(listing: {
    catalogItemId: number | null;
    vendor: string;
    sku: string | null;
    name: string;
    url: string | null;
    priceCents: number | null;
    priceAt: number | null;
  }) {
    setBusy(true);
    setError(null);
    const res = await api.items[":id"].listings.$post({
      param: { id: String(item.id) },
      json: listing,
    });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    await onChanged();
    onClose();
  }

  function typed(e: FormEvent) {
    e.preventDefault();
    void add({
      catalogItemId: null,
      vendor: vendor.trim(),
      sku: sku.trim() || null,
      name: "",
      url: url.trim() || null,
      priceCents: null,
      priceAt: null,
    });
  }

  return (
    <Dialog title="Add a vendor listing" wide onClose={onClose}>
      {ordersOn && (
        <section className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-secondary-400">
            From the Orders catalog
          </p>
          <CatalogPick
            taken={taken}
            initialQuery={item.listings.length === 0 ? item.name : ""}
            onPick={(part) =>
              void add({
                catalogItemId: part.id,
                vendor: part.vendor,
                sku: part.sku,
                name: part.name,
                url: part.url,
                priceCents: partPriceCents(part),
                priceAt: part.priceAt,
              })
            }
          />
        </section>
      )}
      <form
        onSubmit={typed}
        className={ordersOn ? "space-y-3 border-t border-secondary-200 pt-4" : "space-y-3"}
      >
        {ordersOn && (
          <p className="text-xs font-bold uppercase tracking-widest text-secondary-400">
            Or type one in
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor">
            <input
              className={inputClass}
              maxLength={100}
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
          </Field>
          <Field label="Part number">
            <input
              className={inputClass}
              maxLength={100}
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Product page">
          <input
            className={inputClass}
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          disabled={busy || (!vendor.trim() && !url.trim())}
        >
          Add this listing
        </Button>
      </form>
      {error && <ErrorBanner message={error} />}
    </Dialog>
  );
}

/** Makes one listing its own entry again, with as many of the parts as are that vendor's. */
function SplitDialog({
  item,
  listing,
  onClose,
}: { item: ItemView; listing: ListingView; onClose: () => void }) {
  const { places, reload } = useInventory();
  const navigate = useNavigate();
  const [name, setName] = useState(
    listing.name || [listing.vendor, listing.sku].filter(Boolean).join(" "),
  );
  const [moving, setMoving] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = item.stock.filter((row) => row.quantity > 0);

  async function split(e: FormEvent) {
    e.preventDefault();
    const stock = [];
    for (const row of rows) {
      const n = Number(moving[row.id] || 0);
      if (!Number.isInteger(n) || n < 0 || n > row.quantity) {
        return setError(`Enter 0 to ${row.quantity} for each place.`);
      }
      if (n > 0) stock.push({ stockId: row.id, quantity: n });
    }
    setBusy(true);
    setError(null);
    const res = await api.items[":id"].split.$post({
      param: { id: String(item.id) },
      json: { listingId: listing.id, name: name.trim(), stock },
    });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    const { id } = await res.json();
    await reload();
    navigate(`/items/${id}`);
  }

  return (
    <Dialog title="Split off a listing" onClose={onClose}>
      <form onSubmit={split} className="space-y-4">
        <p className="text-sm text-secondary-600">
          The listing becomes its own entry. Say how many parts go with it.
        </p>
        <Field label="The new entry's name">
          <input
            className={inputClass}
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {rows.map((row) => (
          <Field
            key={row.id}
            label={`From ${locationLabel(row.locationId, places)}${
              row.status === "in_use" ? ` (in use on ${useLabel(row, places)})` : ""
            }`}
            hint={`${row.quantity} there now`}
          >
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={0}
              max={row.quantity}
              step={1}
              placeholder="0"
              value={moving[row.id] ?? ""}
              onChange={(e) => setMoving({ ...moving, [row.id]: e.target.value })}
            />
          </Field>
        ))}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Splitting…" : "Split off"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ListingsCard({
  item,
  onChanged,
}: { item: ItemView; onChanged: () => Promise<void> }) {
  const parts = useCatalog();
  const [adding, setAdding] = useState(false);
  const [splitting, setSplitting] = useState<ListingView | null>(null);

  return (
    <Card title="Vendor listings">
      {item.listings.length === 0 ? (
        <p className="text-sm text-secondary-500">
          No listings yet. Add one to see its product page and price.
        </p>
      ) : (
        <ul className="space-y-3">
          {item.listings.map((listing) => (
            <ListingPanel
              key={listing.id}
              item={item}
              listing={listing}
              part={catalogPartFor(listing, parts)}
              onChanged={onChanged}
              onSplit={() => setSplitting(listing)}
            />
          ))}
        </ul>
      )}
      {item.listings.length > 1 && (
        <p className="mt-3 text-xs text-secondary-500">Equivalent parts, counted together.</p>
      )}
      <div className="mt-4">
        <Button variant="secondary" onClick={() => setAdding(true)}>
          Add a listing
        </Button>
      </div>
      {adding && (
        <AddListingDialog item={item} onClose={() => setAdding(false)} onChanged={onChanged} />
      )}
      {splitting && (
        <SplitDialog item={item} listing={splitting} onClose={() => setSplitting(null)} />
      )}
    </Card>
  );
}
