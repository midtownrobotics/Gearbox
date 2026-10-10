import type { LocationRow } from "@g3/worker-inventory";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { count } from "../../shared/format";
import { useInventory } from "../../shared/inventory-data";
import { LocationPicker } from "../../shared/location-picker";
import { type Places, labelOf, locationLabel, useLabel } from "../../shared/places";
import { type Row, rowsOf } from "../../shared/rows";
import { type StockAction, StockActionDialog } from "../../shared/stock-cells";
import {
  Button,
  Card,
  Dialog,
  ErrorBanner,
  Field,
  Page,
  StatusBadge,
  inputClass,
} from "../../shared/ui";

// The inventory the other way round: every location, as nested panels that open, with what's
// kept in each. For rearranging: an entry, or everything in a location, moves somewhere else
// whole. A location's description (what belongs there) is added from its bar.

/** A top-level location starts open if it has this many places inside it, or fewer. */
const OPEN_UP_TO = 20;

/** An entry in a place, with the stock row it's there as. */
type Held = Row & { stock: NonNullable<Row["stock"]> };

type Contents = {
  /** What's kept directly in each location. */
  own: Map<number, Held[]>;
  /** Entries and parts in a location and everything inside it. */
  totals: Map<number, { entries: number; parts: number }>;
};

function contentsOf(items: ReturnType<typeof useInventory>["items"], places: Places): Contents {
  const own = new Map<number, Held[]>();
  for (const item of items) {
    for (const row of rowsOf(item)) {
      if (!row.stock) continue;
      const list = own.get(row.stock.locationId);
      if (list) list.push(row as Held);
      else own.set(row.stock.locationId, [row as Held]);
    }
  }
  const totals = new Map<number, { entries: number; parts: number }>();
  const total = (id: number): { ids: Set<number>; parts: number } => {
    const mine = own.get(id) ?? [];
    const ids = new Set(mine.map((row) => row.item.id));
    let parts = mine.reduce((sum, row) => sum + row.stock.quantity, 0);
    for (const child of places.childrenOf.get(id) ?? []) {
      const inside = total(child.id);
      for (const itemId of inside.ids) ids.add(itemId);
      parts += inside.parts;
    }
    totals.set(id, { entries: ids.size, parts });
    return { ids, parts };
  };
  for (const top of places.childrenOf.get(null) ?? []) total(top.id);
  return { own, totals };
}

/**
 * The box a location's description is typed into: a few words on what's kept there, shown under
 * its name here and beside it everywhere else ("A1 - Misc. Electronics"). It opens under the name,
 * and saves on Enter or on clicking away; Escape or Cancel leaves the description as it was.
 */
function DescriptionEditor({ row, onDone }: { row: LocationRow; onDone: () => void }) {
  const { reload } = useInventory();
  const [text, setText] = useState(row.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Escape and Cancel close the box, and a box that's closing must not save as it loses focus.
  const left = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // The box opens ready to type in.
  useEffect(() => input.current?.focus(), []);

  function cancel() {
    left.current = true;
    onDone();
  }

  async function save() {
    if (left.current) return;
    const title = text.trim();
    if (title === row.title) return onDone();
    setBusy(true);
    setError(null);
    try {
      const res = await api.locations[":id"].title.$put({
        param: { id: String(row.id) },
        json: { title },
      });
      if (!res.ok) return setError(await getErrorMessage(res));
      await reload();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1.5 pl-5">
      <div className="flex items-baseline gap-3">
        <input
          ref={input}
          className={`min-w-0 max-w-md flex-1 rounded-md border bg-surface px-2 py-1 text-sm text-secondary-900 placeholder:text-secondary-400 focus:outline-none focus:border-primary-500 ${
            error ? "border-red-400" : "border-secondary-300"
          }`}
          aria-label={`Description of ${row.name}`}
          placeholder="What's kept here"
          maxLength={60}
          disabled={busy}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => {
            left.current = false;
          }}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") cancel();
          }}
        />
        <button
          type="button"
          className={textButton}
          disabled={busy}
          // Pressing Cancel takes the focus from the box first: that must not save.
          onPointerDown={() => {
            left.current = true;
          }}
          onClick={cancel}
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-0.5 text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** Moves everything kept directly in a location to another one. */
function MoveContentsDialog({
  row,
  held,
  onClose,
}: { row: LocationRow; held: Held[]; onClose: () => void }) {
  const { places, reload } = useInventory();
  const [toLocationId, setToLocationId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entries = new Set(held.map((h) => h.item.id)).size;
  const parts = held.reduce((sum, h) => sum + h.stock.quantity, 0);

  async function move(e: FormEvent) {
    e.preventDefault();
    if (toLocationId === null) return setError("Pick where they're going.");
    if (toLocationId === row.id) return setError("Pick a different location.");
    setBusy(true);
    setError(null);
    try {
      const res = await api.locations[":id"]["move-contents"].$post({
        param: { id: String(row.id) },
        json: { toLocationId },
      });
      if (!res.ok) return setError(await getErrorMessage(res));
      await reload();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Move everything in ${labelOf(row)}`} onClose={onClose}>
      <form onSubmit={move} className="space-y-4">
        <p className="text-sm text-secondary-600">
          {count(entries, "entry", "entries")} ({count(parts, "part")}) in{" "}
          <span className="font-semibold text-secondary-900">{locationLabel(row.id, places)}</span>{" "}
          move to the place you pick.
        </p>
        <Field label="Move them to">
          <LocationPicker places={places} value={toLocationId} onChange={setToLocationId} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Moving…" : "Move everything"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const smallButton =
  "whitespace-nowrap rounded-lg border border-secondary-300 bg-surface px-2.5 py-1 text-xs font-semibold text-secondary-800 hover:bg-secondary-50";
/** A plain text button, like the ones beside each location on Settings. */
const textButton =
  "-my-1 whitespace-nowrap py-1 text-xs text-secondary-500 hover:text-primary-600 disabled:opacity-50";

function Panel({
  row,
  depth,
  places,
  contents,
  isOpen,
  toggle,
  shown,
  onMoveEntry,
  onMoveAll,
}: {
  row: LocationRow;
  depth: number;
  places: Places;
  contents: Contents;
  isOpen: (id: number) => boolean;
  toggle: (id: number) => void;
  /** When a search is on: the locations to show. Null shows them all. */
  shown: Set<number> | null;
  onMoveEntry: (held: Held) => void;
  onMoveAll: (row: LocationRow) => void;
}) {
  const children = (places.childrenOf.get(row.id) ?? []).filter(
    (child) => !shown || shown.has(child.id),
  );
  const own = contents.own.get(row.id) ?? [];
  const total = contents.totals.get(row.id) ?? { entries: 0, parts: 0 };
  const open = isOpen(row.id);
  const [describing, setDescribing] = useState(false);

  return (
    <section
      className={`rounded-xl border border-secondary-200 ${depth === 1 ? "bg-surface" : "bg-secondary-50"}`}
    >
      <header className="px-3 py-2">
        {/* The count is always at the right of the first line, whatever is beside the name. */}
        <div className="flex items-baseline gap-x-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={() => toggle(row.id)}
              aria-expanded={open}
              className="flex min-w-0 items-baseline gap-2 text-left text-sm font-semibold text-secondary-900 hover:text-primary-600"
            >
              <span className="inline-block w-3 shrink-0 text-secondary-400" aria-hidden>
                {open ? "▾" : "▸"}
              </span>
              <span className="min-w-0 break-words">{row.name}</span>
            </button>
            {!row.title && !describing && (
              <button type="button" className={textButton} onClick={() => setDescribing(true)}>
                Add description
              </button>
            )}
          </div>
          <span className="shrink-0 whitespace-nowrap text-xs text-secondary-500">
            {total.entries === 0
              ? "Empty"
              : `${count(total.entries, "entry", "entries")} · ${count(total.parts, "part")}`}
          </span>
        </div>
        {describing ? (
          <DescriptionEditor row={row} onDone={() => setDescribing(false)} />
        ) : (
          row.title && (
            <p className="break-words pl-5 text-sm text-secondary-600">
              {row.title}{" "}
              <button
                type="button"
                className={`${textButton} ml-1`}
                aria-label={`Edit the description of ${row.name}`}
                onClick={() => setDescribing(true)}
              >
                Edit
              </button>
            </p>
          )
        )}
      </header>
      {open && (
        <div className="space-y-2 border-t border-secondary-200 px-3 py-2.5">
          {own.length > 0 && (
            <ul className="divide-y divide-secondary-100 rounded-lg border border-secondary-200 bg-surface">
              {own.map((held) => (
                <li
                  key={held.stock.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm"
                >
                  <span className="w-12 shrink-0 text-right font-semibold tabular-nums text-secondary-900">
                    {held.stock.quantity}
                  </span>
                  <Link
                    to={`/items/${held.item.id}`}
                    className="min-w-0 flex-1 basis-40 text-secondary-900 hover:text-primary-600"
                  >
                    {held.item.name}
                  </Link>
                  {held.stock.status === "in_use" && (
                    <span className="flex items-center gap-2 text-xs text-secondary-500">
                      <StatusBadge status="in_use" />
                      {useLabel(held.stock, places)}
                    </span>
                  )}
                  <button type="button" className={smallButton} onClick={() => onMoveEntry(held)}>
                    Move…
                  </button>
                </li>
              ))}
            </ul>
          )}
          {own.length > 0 && (
            <div className="flex justify-end">
              <button type="button" className={smallButton} onClick={() => onMoveAll(row)}>
                Move all…
              </button>
            </div>
          )}
          {children.map((child) => (
            <Panel
              key={child.id}
              row={child}
              depth={depth + 1}
              places={places}
              contents={contents}
              isOpen={isOpen}
              toggle={toggle}
              shown={shown}
              onMoveEntry={onMoveEntry}
              onMoveAll={onMoveAll}
            />
          ))}
          {own.length === 0 && children.length === 0 && (
            <p className="text-sm text-secondary-500">Nothing is kept here.</p>
          )}
        </div>
      )}
    </section>
  );
}

export function LocationsPage() {
  const { items, places } = useInventory();
  const { isAdmin } = useAuthUser();
  const top = places.childrenOf.get(null) ?? [];
  const contents = useMemo(() => contentsOf(items, places), [items, places]);
  // Which panels have been opened or closed by hand; the rest follow the starting rule.
  const [toggled, setToggled] = useState<Map<number, boolean>>(new Map());
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<StockAction | null>(null);
  const [movingAll, setMovingAll] = useState<LocationRow | null>(null);

  // A search shows the locations it finds (by name, description, or an entry kept there), opened, with
  // what they're inside.
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    const found = new Set<number>();
    for (const row of places.locations) {
      const text = [labelOf(row), ...(contents.own.get(row.id) ?? []).map((held) => held.item.name)]
        .join(" ")
        .toLowerCase();
      if (!words.every((word) => text.includes(word))) continue;
      for (let at: LocationRow | undefined = row; at && !found.has(at.id); ) {
        found.add(at.id);
        at = at.parentId === null ? undefined : places.byId.get(at.parentId);
      }
    }
    return found;
  }, [query, places, contents]);

  const isOpen = (id: number) => {
    if (shown) return true;
    const chosen = toggled.get(id);
    if (chosen !== undefined) return chosen;
    const row = places.byId.get(id);
    return row?.parentId === null && (places.childrenOf.get(id) ?? []).length <= OPEN_UP_TO;
  };
  const toggle = (id: number) => setToggled((current) => new Map(current).set(id, !isOpen(id)));
  const setAll = (open: boolean) =>
    setToggled(new Map(places.locations.map((row) => [row.id, open])));

  const visibleTop = top.filter((row) => !shown || shown.has(row.id));

  return (
    <Page
      title="Locations"
      wide
      actions={
        top.length > 0 && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setAll(true)}>
              Open all
            </Button>
            <Button variant="secondary" onClick={() => setAll(false)}>
              Close all
            </Button>
          </div>
        )
      }
    >
      {top.length === 0 ? (
        <Card>
          <p className="text-secondary-700">No locations have been set up yet.</p>
          <p className="mt-1 text-sm text-secondary-500">
            {isAdmin
              ? "Add them on Settings, or load a setup file there."
              : "An admin adds them on Settings."}
          </p>
        </Card>
      ) : (
        <>
          <p className="text-sm text-secondary-500">
            What's kept where. Move an entry or everything in a location, and describe what each
            place is for.
          </p>
          <input
            type="search"
            className={`${inputClass} max-w-md`}
            placeholder="Find a location, a description or a part…"
            aria-label="Search locations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {visibleTop.length === 0 && (
            <p className="text-sm text-secondary-500">Nothing matches.</p>
          )}
          <div className="space-y-3">
            {visibleTop.map((row) => (
              <Panel
                key={row.id}
                row={row}
                depth={1}
                places={places}
                contents={contents}
                isOpen={isOpen}
                toggle={toggle}
                shown={shown}
                onMoveEntry={(held) =>
                  setAction({ kind: "move", item: held.item, stock: held.stock })
                }
                onMoveAll={setMovingAll}
              />
            ))}
          </div>
        </>
      )}
      <StockActionDialog action={action} onClose={() => setAction(null)} />
      {movingAll && (
        <MoveContentsDialog
          row={movingAll}
          held={contents.own.get(movingAll.id) ?? []}
          onClose={() => setMovingAll(null)}
        />
      )}
    </Page>
  );
}
