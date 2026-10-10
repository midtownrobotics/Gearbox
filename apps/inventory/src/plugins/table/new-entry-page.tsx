import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { type CatalogPart, partPriceCents, useOrdersOn } from "../../shared/catalog";
import { CatalogPick, partLine } from "../../shared/catalog-pick";
import { type Draft, FieldInputs, draftOf, valuesOf } from "../../shared/field-inputs";
import { useInventory } from "../../shared/inventory-data";
import { LocationPicker } from "../../shared/location-picker";
import { Button, Card, ErrorBanner, Field, Page, inputClass } from "../../shared/ui";

/** Catalog parts already on an entry (a part is on one entry at most), by the entry's name. */
export function useTakenParts(): Map<number, string> {
  const { items } = useInventory();
  return useMemo(() => {
    const taken = new Map<number, string>();
    for (const item of items) {
      for (const listing of item.listings) {
        if (listing.catalogItemId !== null) taken.set(listing.catalogItemId, item.name);
      }
    }
    return taken;
  }, [items]);
}

/**
 * A new entry: its name and the team's fields, and optionally how many there are, where they're
 * kept, and the part in Orders' catalog it is.
 */
export function NewEntryPage() {
  const { fields, places, items, reload } = useInventory();
  const navigate = useNavigate();
  const taken = useTakenParts();
  const ordersOn = useOrdersOn();
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Draft>(() => draftOf(fields, {}));
  const [quantity, setQuantity] = useState("");
  const [locationId, setLocationId] = useState<number | null>(null);
  const [part, setPart] = useState<CatalogPart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const twin = items.find((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase());

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = valuesOf(fields, draft);
    if ("error" in parsed) return setError(parsed.error);
    const n = quantity.trim() === "" ? null : Number(quantity);
    if (n !== null && (!Number.isInteger(n) || n < 0)) {
      return setError("Quantity must be a whole number.");
    }
    if (n !== null && locationId === null) return setError("Pick where they're kept.");
    setBusy(true);
    setError(null);
    try {
      const res = await api.items.$post({
        json: {
          name: name.trim(),
          values: parsed.values,
          stock: locationId === null ? null : { quantity: n ?? 0, locationId },
          listing: part && {
            catalogItemId: part.id,
            vendor: part.vendor,
            sku: part.sku,
            name: part.name,
            url: part.url,
            priceCents: partPriceCents(part),
            priceAt: part.priceAt,
          },
        },
      });
      if (!res.ok) return setError(await getErrorMessage(res));
      const { id } = await res.json();
      await reload();
      navigate(`/items/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Add an entry">
      <form onSubmit={save} className="space-y-5">
        <Card title="What it is">
          <div className="space-y-4">
            <Field label="Name">
              <input
                className={inputClass}
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {twin && (
              <p className="text-sm text-amber-700">
                There's already an entry with this name:{" "}
                <Link to={`/items/${twin.id}`} className="font-semibold underline">
                  {twin.name}
                </Link>
                . To add more of it, add parts on its page.
              </p>
            )}
            <FieldInputs fields={fields} draft={draft} onChange={setDraft} />
          </div>
        </Card>

        <Card title="How many, and where">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity" hint="Leave empty if it hasn't been counted.">
              <input
                className={inputClass}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label="Storage location">
              <LocationPicker places={places} value={locationId} onChange={setLocationId} />
            </Field>
          </div>
        </Card>

        {ordersOn && (
          <Card title="Part in the Orders catalog">
            {part ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-secondary-900">{part.name}</p>
                  <p className="text-xs text-secondary-500">{partLine(part)}</p>
                </div>
                <Button variant="secondary" onClick={() => setPart(null)}>
                  Remove
                </Button>
              </div>
            ) : (
              <>
                <p className="mb-2 text-sm text-secondary-500">
                  Optional. Shows the part's product page and price here, and adds received orders
                  of it to this entry.
                </p>
                <CatalogPick
                  taken={taken}
                  onPick={(picked) => {
                    setPart(picked);
                    if (!name.trim()) setName(picked.name);
                  }}
                />
              </>
            )}
          </Card>
        )}

        {error && <ErrorBanner message={error} />}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add entry"}
          </Button>
          <Link
            to="/inventory"
            className="rounded-lg border border-secondary-300 bg-surface px-3.5 py-2 text-sm font-semibold text-secondary-800 hover:bg-secondary-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </Page>
  );
}
