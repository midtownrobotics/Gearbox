import type { FieldType, FieldView } from "@g3/worker-inventory";
import { type FormEvent, useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { useInventory } from "../../shared/inventory-data";
import {
  Button,
  Card,
  ConfirmButton,
  Dialog,
  ErrorBanner,
  Field,
  inputClass,
} from "../../shared/ui";

// The fields an entry is described by, beyond its name. They're the team's own: what one team
// calls "Item type" another doesn't track at all.

const TYPE_LABELS: Record<FieldType, string> = {
  text: "Short text",
  paragraph: "Long text",
  number: "Number",
  choice: "Choice from a list",
  checkbox: "Checkbox",
  link: "Link",
  date: "Date",
};

type Response = { ok: boolean; status: number; json(): Promise<unknown> };

const smallButton = "text-xs text-secondary-500 hover:text-primary-600 disabled:opacity-40";

const choicesOf = (text: string) => [
  ...new Set(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  ),
];

/** Adds a field, or changes one. A field's type is set when it's made. */
function FieldDialog({ field, onClose }: { field: FieldView | null; onClose: () => void }) {
  const { reload } = useInventory();
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<FieldType>(field?.type ?? "text");
  const [choices, setChoices] = useState(field?.options.join("\n") ?? "");
  const [showInTable, setShowInTable] = useState(field?.showInTable ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(request: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    const res = await request();
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    await reload();
    onClose();
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const options = type === "choice" ? choicesOf(choices) : [];
    if (type === "choice" && options.length === 0) {
      return setError("List at least one choice.");
    }
    const json = { name: name.trim(), options, showInTable };
    void send(() =>
      field
        ? api.fields[":id"].$patch({ param: { id: String(field.id) }, json })
        : api.fields.$post({ json: { ...json, type } }),
    );
  }

  return (
    <Dialog title={field ? `Edit ${field.name}` : "Add a field"} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Name">
          <input
            className={inputClass}
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Kind" hint={field ? "A field's kind can't be changed." : undefined}>
          <select
            className={inputClass}
            disabled={field !== null}
            value={type}
            onChange={(e) => setType(e.target.value as FieldType)}
          >
            {(Object.keys(TYPE_LABELS) as FieldType[]).map((key) => (
              <option key={key} value={key}>
                {TYPE_LABELS[key]}
              </option>
            ))}
          </select>
        </Field>
        {type === "choice" && (
          <Field label="Choices" hint="One on each line.">
            <textarea
              className={inputClass}
              rows={6}
              value={choices}
              onChange={(e) => setChoices(e.target.value)}
            />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm text-secondary-700">
          <input
            type="checkbox"
            checked={showInTable}
            onChange={(e) => setShowInTable(e.target.checked)}
          />
          Show as a column in the main table
        </label>
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-wrap justify-between gap-2">
          {field ? (
            <ConfirmButton
              label="Delete"
              question={`Delete the field “${field.name}”? What entries have in it is lost.`}
              confirmLabel="Delete the field"
              disabled={busy}
              onConfirm={() =>
                void send(() => api.fields[":id"].$delete({ param: { id: String(field.id) } }))
              }
            />
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

export function FieldsCard() {
  const { fields, reload } = useInventory();
  const [editing, setEditing] = useState<FieldView | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(index: number, by: -1 | 1) {
    const ids = fields.map((field) => field.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    setError(null);
    const res = await api.fields.order.$put({ json: { ids } });
    if (!res.ok) return setError(await getErrorMessage(res));
    await reload();
  }

  return (
    <Card title="Fields">
      <p className="mb-3 text-sm text-secondary-500">
        What's recorded about each entry, beyond its name, quantity and location. Everyone fills
        these in when adding or editing an entry.
      </p>
      {fields.length > 0 && (
        <ul className="mb-3 divide-y divide-secondary-100">
          {fields.map((field, index) => (
            <li key={field.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-sm font-semibold text-secondary-900">{field.name}</p>
                <p className="text-xs text-secondary-500">
                  {TYPE_LABELS[field.type]}
                  {field.type === "choice" && `: ${field.options.join(", ")}`}
                  {!field.showInTable && " · not in the table"}
                </p>
              </div>
              <button
                type="button"
                className={smallButton}
                disabled={index === 0}
                aria-label={`Move ${field.name} up`}
                onClick={() => void move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className={smallButton}
                disabled={index === fields.length - 1}
                aria-label={`Move ${field.name} down`}
                onClick={() => void move(index, 1)}
              >
                ↓
              </button>
              <button type="button" className={smallButton} onClick={() => setEditing(field)}>
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      )}
      <Button variant="secondary" onClick={() => setEditing("new")}>
        Add a field
      </Button>
      {editing && (
        <FieldDialog field={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Card>
  );
}
