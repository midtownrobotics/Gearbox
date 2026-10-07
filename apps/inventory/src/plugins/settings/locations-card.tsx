import type { LocationRow } from "@g3/worker-inventory";
import { type FormEvent, useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { count } from "../../shared/format";
import { useInventory } from "../../shared/inventory-data";
import { LocationPicker } from "../../shared/location-picker";
import { MAX_DEPTH, type Places, pathOf } from "../../shared/places";
import {
  Button,
  Card,
  ConfirmButton,
  Dialog,
  ErrorBanner,
  Field,
  inputClass,
} from "../../shared/ui";

// The team's tree of locations: top-level places (a room, a trailer), each with places inside it
// (a cabinet, a shelf), down to four levels.

type Response = { ok: boolean; status: number; json(): Promise<unknown> };

const smallButton = "text-xs text-secondary-500 hover:text-primary-600 disabled:opacity-50";

/** Names from a box with one on each line. */
const namesOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** Adds locations at the top level or inside one: several at once, one on each line. */
function AddDialog({ parent, onClose }: { parent: LocationRow | null; onClose: () => void }) {
  const { reload } = useInventory();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = namesOf(text);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api.locations.$post({ json: { parentId: parent?.id ?? null, names } });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    await reload();
    onClose();
  }

  return (
    <Dialog title={parent ? `Add inside ${parent.name}` : "Add locations"} onClose={onClose}>
      <form onSubmit={add} className="space-y-4">
        <Field label="Names" hint="One on each line. Names already there are skipped.">
          <textarea
            className={inputClass}
            rows={6}
            placeholder={"Shelf A\nShelf B"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || names.length === 0 || names.length > 200}>
            {busy ? "Adding…" : names.length > 1 ? `Add ${names.length}` : "Add"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Renames a location, or moves it (with everything inside) to another place in the tree. */
function EditDialog({ row, onClose }: { row: LocationRow; onClose: () => void }) {
  const { places, reload } = useInventory();
  const [name, setName] = useState(row.name);
  const [parentId, setParentId] = useState<number | null>(row.parentId);
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
  const param = { id: String(row.id) };

  return (
    <Dialog title={`Edit ${row.name}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => api.locations[":id"].$patch({ param, json: { name, parentId } }));
        }}
      >
        <Field label="Name">
          <input
            className={inputClass}
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Inside" hint="Moving it takes everything inside it along.">
          <LocationPicker
            places={places}
            value={parentId}
            onChange={setParentId}
            label="Inside"
            emptyLabel="Nothing (top level)"
          />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-wrap justify-between gap-2">
          <ConfirmButton
            label="Delete"
            question={`Delete “${row.name}” and everything inside it? This only works if no parts are kept there.`}
            confirmLabel="Delete the location"
            disabled={busy}
            onConfirm={() => void send(() => api.locations[":id"].$delete({ param }))}
          />
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

function Node({
  row,
  places,
  open,
  toggle,
  onAdd,
  onEdit,
}: {
  row: LocationRow;
  places: Places;
  open: Set<number>;
  toggle: (id: number) => void;
  onAdd: (row: LocationRow) => void;
  onEdit: (row: LocationRow) => void;
}) {
  const children = places.childrenOf.get(row.id) ?? [];
  const isOpen = open.has(row.id);
  const depth = pathOf(row.id, places).length;
  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
        {children.length > 0 ? (
          <button
            type="button"
            onClick={() => toggle(row.id)}
            aria-expanded={isOpen}
            className="flex items-center gap-1.5 text-sm text-secondary-900 hover:text-primary-600"
          >
            <span className="inline-block w-3 text-secondary-400" aria-hidden>
              {isOpen ? "▾" : "▸"}
            </span>
            <span className="font-semibold">{row.name}</span>
            <span className="text-xs text-secondary-400">{children.length}</span>
          </button>
        ) : (
          <span className="pl-[1.125rem] text-sm text-secondary-900">{row.name}</span>
        )}
        {depth < MAX_DEPTH && (
          <button type="button" className={smallButton} onClick={() => onAdd(row)}>
            Add inside
          </button>
        )}
        <button type="button" className={smallButton} onClick={() => onEdit(row)}>
          Edit
        </button>
      </div>
      {isOpen && children.length > 0 && (
        <ul className="ml-4 border-l border-secondary-200 pl-3">
          {children.map((child) => (
            <Node
              key={child.id}
              row={child}
              places={places}
              open={open}
              toggle={toggle}
              onAdd={onAdd}
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function LocationsCard() {
  const { places } = useInventory();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState<LocationRow | "top" | null>(null);
  const [editing, setEditing] = useState<LocationRow | null>(null);
  const top = places.childrenOf.get(null) ?? [];

  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card title="Locations">
      <p className="mb-3 text-sm text-secondary-500">
        Where parts are kept, as a tree: a room, what's in it, and so on, up to {MAX_DEPTH} levels.
        {places.locations.length > 0 && ` ${count(places.locations.length, "location")} so far.`}
      </p>
      {top.length > 0 && (
        <ul className="mb-3">
          {top.map((row) => (
            <Node
              key={row.id}
              row={row}
              places={places}
              open={open}
              toggle={toggle}
              onAdd={(parent) => {
                setAdding(parent);
                setOpen((current) => new Set(current).add(parent.id));
              }}
              onEdit={setEditing}
            />
          ))}
        </ul>
      )}
      <Button variant="secondary" onClick={() => setAdding("top")}>
        Add top-level locations
      </Button>
      {adding && (
        <AddDialog parent={adding === "top" ? null : adding} onClose={() => setAdding(null)} />
      )}
      {editing && <EditDialog row={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}
