import { useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import type { CatalogItem } from "../../shared/types";
import { Button, Card, ErrorBanner, Field, inputClass } from "../../shared/ui";

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
    };
    if (!json.name || !json.category || !json.vendor || !json.url) {
      return setError("Name, category, vendor and link are all needed.");
    }
    setBusy(true);
    setError(null);
    const res = item
      ? await api.catalog.items[":id"].$patch({ param: { id: String(item.id) }, json })
      : await api.catalog.items.$post({ json });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    onDone(true);
  }

  async function remove() {
    if (!item || !window.confirm(`Delete “${item.name}” from the catalog?`)) return;
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
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={300}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Link" hint="The product page, if you can find it">
            <input
              type="url"
              className={inputClass}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </Field>
        </div>
        <Field label="Vendor">
          <input
            className={inputClass}
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
          />
        </Field>
        <Field label="Part number">
          <input className={inputClass} value={sku} onChange={(e) => setSku(e.target.value)} />
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
            <textarea
              className={`${inputClass} min-h-16 font-mono text-xs`}
              value={options}
              onChange={(e) => setOptions(e.target.value)}
            />
          </Field>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : item ? "Save" : "Add to catalog"}
        </Button>
        <Button variant="secondary" onClick={() => onDone(false)} disabled={busy}>
          Cancel
        </Button>
        {item && (
          <Button variant="danger" onClick={remove} disabled={busy} className="ml-auto">
            Delete
          </Button>
        )}
      </div>
    </Card>
  );
}
