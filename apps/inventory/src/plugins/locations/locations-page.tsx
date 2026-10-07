import type { LocationRow } from "@g3/worker-inventory";
import { type FormEvent, useEffect, useMemo, useState } from "react";
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
// whole. A location's title (what belongs there) is typed into its bar.

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
 * A location's title, typed into its bar: a few words on what's kept there, shown beside its name
 * everywhere. Saved on Enter or on clicking away.
 */
function TitleInput({ row }: { row: LocationRow }) {
  const { reload } = useInventory();
  const [text, setText] = useState(row.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setText(row.title), [row.title]);

  async function save() {
    const title = text.trim();
    if (title === row.title) return setText(title);
    setBusy(true);
    setError(null);
    try {
      const res = await api.locations[":id"].title.$put({
        param: { id: String(row.id) },
        json: { title },
      });
      if (!res.ok) return setError(await getErrorMessage(res));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex min-w-0 flex-1 basis-48 flex-col">
      <input
        className={`w-full max-w-xs rounded-md border bg-surface px-2 py-1 text-sm text-secondary-900 placeholder:text-secondary-400 focus:outline-none focus:border-primary-500 ${
          error ? "border-primary-400" : "border-secondary-200 hover:border-secondary-400"
        }`}
        aria-label={`Title for ${row.name}`}
        placeholder="Title: what's kept here"
        maxLength={60}
        disabled={busy}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(row.title);
            setError(null);
          }
        }}
      />
      {error && <span className="mt-0.5 text-xs text-primary-700">{error}</span>}
    </span>
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
          {count(entries, "entry", "entries")} ({count(parts, "part")}) kept in{" "}
          <span className="font-semibold text-secondary-900">{locationLabel(row.id, places)}</span>{" "}
          move to the place you pick, all of each. The locations themselves stay as they are.
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

  return (
    <section
      className={`rounded-xl border border-secondary-200 ${depth === 1 ? "bg-surface" : "bg-secondary-50"}`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <button
          type="button"
          onClick={() => toggle(row.id)}
          aria-expanded={open}
          className="flex items-center gap-2 text-left text-sm font-semibold text-secondary-900 hover:text-primary-600"
        >
          <span className="inline-block w-3 text-secondary-400" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          {row.name}
        </button>
        <TitleInput row={row} />
        <span className="ml-auto whitespace-nowrap text-xs text-secondary-500">
          {total.entries === 0
            ? "Empty"
            : `${count(total.entries, "entry", "entries")} · ${count(total.parts, "part")}`}
        </span>
        {own.length > 0 && (
          <button type="button" className={smallButton} onClick={() => onMoveAll(row)}>
            Move all…
          </button>
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

  // A search shows the locations it finds (by name, title, or an entry kept there), opened, with
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
            What's kept where. Move an entry, or everything in a location, when things are
            rearranged: all of it moves at once. A title says what belongs in a place, and shows
            beside its name everywhere.
          </p>
          <input
            type="search"
            className={`${inputClass} max-w-md`}
            placeholder="Find a location, a title or a part…"
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
