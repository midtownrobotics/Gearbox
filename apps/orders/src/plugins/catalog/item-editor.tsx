import { Button, Card, ConfirmButton, ErrorBanner, Field, TextField, inputClass } from "@g3/ui";
import { useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { PackInput } from "../../shared/pack";
import { parseQuantity, quantityError } from "../../shared/quantity";
import type { CatalogItem } from "../../shared/types";

/** "Length: 1/2\"" per line ↔ {"Length": "1/2\""}. */
const optionsText = (options: Record<string, string>) =>
  Object.entries(options)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

function parseOptions(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf(":");
    if (at > 0 && line.slice(at + 1).trim())
      out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

/** Adds a part to the catalog, or fixes or deletes one (anyone can). */
export function ItemEditor({
  item,
  categories,
  onDone,
}: {
  item?: CatalogItem;
  categories: string[];
  /** Called with true when something was saved or deleted. */
  onDone: (saved: boolean) => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [vendor, setVendor] = useState(item?.vendor ?? "");
  const [sku, setSku] = useState(item?.sku ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [packQuantity, setPackQuantity] = useState(String(item?.packQuantity ?? 1));
  const [packUnit, setPackUnit] = useState(item?.packUnit ?? "");
  const [options, setOptions] = useState(optionsText(item?.options ?? {}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const json = {
      name: name.trim(),
      category: category.trim(),
      vendor: vendor.trim(),
      sku: sku.trim() || null,
      url: url.trim(),
      options: parseOptions(options),
      packQuantity: parseQuantity(packQuantity),
      packUnit: packUnit.trim(),
    };
    if (!json.name || !json.category || !json.vendor || !json.url) {
      return setError("Name, category, vendor and link are all needed.");
    }
    if (json.packQuantity === null) {
      return setError("Pack of must be a whole number from 1 to 10000.");
    }
    setBusy(true);
    setError(null);
    const body = { ...json, packQuantity: json.packQuantity };
    const res = item
      ? await api.catalog.items[":id"].$patch({ param: { id: String(item.id) }, json: body })
      : await api.catalog.items.$post({ json: body });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    onDone(true);
  }

  async function remove() {
    if (!item) return;
    setBusy(true);
    const res = await api.catalog.items[":id"].$delete({ param: { id: String(item.id) } });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    onDone(true);
  }

  return (
    <Card title={item ? "Edit part" : "Add a part"} className="!p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="col-span-2 sm:col-span-4">
          <Field label="Name">
            <TextField
              kind="partName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={300}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Link" hint="The product page, if you can find it">
            <TextField
              kind="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </Field>
        </div>
        <Field label="Vendor">
          <TextField kind="vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </Field>
        <Field label="Part number">
          <TextField kind="sku" value={sku} onChange={(e) => setSku(e.target.value)} />
        </Field>
        <Field
          label="Pack of"
          hint="Parts in one of these, or an amount: 100 ft"
          error={quantityError(packQuantity)}
        >
          <PackInput
            quantity={packQuantity}
            unit={packUnit}
            onQuantity={setPackQuantity}
            onUnit={setPackUnit}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Category" hint="Missing one? Use “New category” first">
            <select
              className={inputClass}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="" disabled>
                Pick one…
              </option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Sizes and types" hint='One per line, like Length: 1/2"'>
            <TextField
              multiline
              kind="options"
              className="min-h-16 font-mono text-xs"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
            />
          </Field>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy || parseQuantity(packQuantity) === null}>
          {busy ? "Saving…" : item ? "Save" : "Add to catalog"}
        </Button>
        <Button variant="secondary" onClick={() => onDone(false)} disabled={busy}>
          Cancel
        </Button>
        {item && (
          <>
            <span className="flex-1" />
            <ConfirmButton
              label="Delete"
              question={`Delete “${item.name}” from the catalog? This can't be undone.`}
              disabled={busy}
              onConfirm={remove}
            />
          </>
        )}
      </div>
    </Card>
  );
}
