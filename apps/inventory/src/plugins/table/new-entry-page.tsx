import { Button, Card, ErrorBanner, Field, Page, TextField } from "@g3/ui";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { type CatalogPart, partPriceCents, useOrdersOn } from "../../shared/catalog";
import { CatalogPick, partLine } from "../../shared/catalog-pick";
import { type Draft, FieldInputs, draftOf, valuesOf } from "../../shared/field-inputs";
import { useInventory } from "../../shared/inventory-data";
import { LocationPicker } from "../../shared/location-picker";
import { QuantityField } from "../../shared/stock-dialogs";
import { UnitField } from "../../shared/units";

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

/** Where the Add an entry page goes back to: the page that opened it, with its filters. */
export type NewEntryFrom = { from?: string };

/**
 * Add an entry. `?location=` picks its storage location to start with (the table's location
 * filter), and Cancel goes back to the page that opened it.
 */
export function NewEntryPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = (useLocation().state as NewEntryFrom | null)?.from ?? "/inventory";
  const location = params.get("location");
  return (
    <Page title="Add an entry">
      <NewEntryForm
        locationId={location ? Number(location) : null}
        onAdded={(id) => navigate(`/items/${id}`)}
        onCancel={() => navigate(from)}
      />
    </Page>
  );
}

/**
 * One part of the form: a card on the page, a plain section in a pop-up (the pop-up is the card).
 */
function Section({
  title,
  framed,
  children,
}: { title: string; framed: boolean; children: ReactNode }) {
  if (framed) return <Card title={title}>{children}</Card>;
  return (
    <section className="border-t border-secondary-200 pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-secondary-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * A new entry: its name and the team's fields, and optionally how many there are, where they're
 * kept (starting at `locationId`), and the part in Orders' catalog it is. On the Add an entry
 * page, or in a pop-up over another page (`framed={false}`).
 */
export function NewEntryForm({
  locationId: startAt = null,
  onAdded,
  onCancel,
  framed = true,
}: {
  locationId?: number | null;
  onAdded: (id: number) => void;
  onCancel: () => void;
  framed?: boolean;
}) {
  const { fields, places, items, reload } = useInventory();
  const taken = useTakenParts();
  const ordersOn = useOrdersOn();
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Draft>(() => draftOf(fields, {}));
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [locationId, setLocationId] = useState<number | null>(() =>
    startAt !== null && places.byId.has(startAt) ? startAt : null,
  );
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
          unit: unit.trim(),
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
      onAdded(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <Section framed={framed} title="What it is">
        <div className="space-y-4">
          <Field label="Name">
            <TextField
              kind="partName"
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
      </Section>

      <Section framed={framed} title="How many, and where">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Unit"
            hint="What one of its quantity is: ft, sheet, kg. Leave empty to count them one by one."
          >
            <UnitField value={unit} onChange={setUnit} />
          </Field>
          <QuantityField
            label="Quantity"
            required={false}
            hint="Leave empty if it hasn't been counted. Whole numbers only: count in a smaller unit for part of one."
            value={quantity}
            onChange={setQuantity}
            unit={unit.trim()}
            min={0}
          />
          <Field label="Storage location">
            <LocationPicker places={places} value={locationId} onChange={setLocationId} />
          </Field>
        </div>
      </Section>

      {ordersOn && (
        <Section framed={framed} title="Part in the Orders catalog">
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
                Optional. Shows the part's product page and price here, and adds received orders of
                it to this entry.
              </p>
              <CatalogPick
                taken={taken}
                onPick={(picked) => {
                  setPart(picked);
                  if (!name.trim()) setName(picked.name);
                  // A part sold by the foot is counted in feet.
                  if (!unit.trim() && picked.packUnit) setUnit(picked.packUnit);
                }}
              />
            </>
          )}
        </Section>
      )}

      {error && <ErrorBanner message={error} />}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add entry"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
