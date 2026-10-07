import {
  type Announcements,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  type UniqueIdentifier,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LocationRow } from "@g3/worker-inventory";
import { type FormEvent, useCallback, useMemo, useState } from "react";
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

/** The six dots of a drag handle. */
function Grip() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="2" cy="3" r="1.5" />
      <circle cx="8" cy="3" r="1.5" />
      <circle cx="2" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="2" cy="13" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />
    </svg>
  );
}

type Tree = {
  places: Places;
  /** What's inside a location (or at the top), in the order shown. */
  inside: (parentId: number | null) => LocationRow[];
  open: Set<number>;
  toggle: (id: number) => void;
  onAdd: (row: LocationRow) => void;
  onEdit: (row: LocationRow) => void;
};

/**
 * The locations inside one place, as a list that can be put in order by dragging. A location is
 * dragged by its handle and stays inside its place: moving it to another one is Edit's job.
 */
function Level({
  parentId,
  tree,
  className,
}: { parentId: number | null; tree: Tree; className: string }) {
  const rows = tree.inside(parentId);
  return (
    <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
      <ul className={className}>
        {rows.map((row) => (
          <Node key={row.id} row={row} tree={tree} alone={rows.length < 2} />
        ))}
      </ul>
    </SortableContext>
  );
}

function Node({ row, tree, alone }: { row: LocationRow; tree: Tree; alone: boolean }) {
  const { places, open, toggle, onAdd, onEdit } = tree;
  const children = tree.inside(row.id);
  const isOpen = open.has(row.id);
  const depth = pathOf(row.id, places).length;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id, disabled: alone });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "relative z-10 rounded-md bg-surface shadow-lg" : undefined}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Move ${row.name}`}
          title="Drag to reorder"
          // With nothing beside it there is nothing to reorder; the space keeps the names lined up.
          className={`-mr-1.5 flex h-6 w-5 touch-none items-center justify-center rounded text-secondary-400 hover:text-secondary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${
            alone ? "invisible" : isDragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <Grip />
        </button>
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
            {row.title && <span className="text-secondary-500">- {row.title}</span>}
            <span className="text-xs text-secondary-400">{children.length}</span>
          </button>
        ) : (
          <span className="pl-[1.125rem] text-sm text-secondary-900">
            {row.name}
            {row.title && <span className="text-secondary-500"> - {row.title}</span>}
          </span>
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
        <Level parentId={row.id} tree={tree} className="ml-4 border-l border-secondary-200 pl-3" />
      )}
    </li>
  );
}

/** A location being dragged only moves up and down its list. */
const upAndDown: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** A few pixels of movement first, so a click on the handle isn't a drag. */
const AFTER_A_NUDGE = { activationConstraint: { distance: 4 } };

export function LocationsCard() {
  const { places, reload } = useInventory();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState<LocationRow | "top" | null>(null);
  const [editing, setEditing] = useState<LocationRow | null>(null);
  // The order just dropped in one place, shown until the saved one comes back.
  const [dropped, setDropped] = useState<{ parentId: number | null; ids: number[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const inside = useCallback(
    (parentId: number | null) => {
      const rows = places.childrenOf.get(parentId) ?? [];
      if (dropped?.parentId !== parentId) return rows;
      const at = new Map(dropped.ids.map((id, index) => [id, index]));
      return [...rows].sort(
        (a, b) => (at.get(a.id) ?? rows.length) - (at.get(b.id) ?? rows.length),
      );
    },
    [places, dropped],
  );
  const parentOf = useCallback(
    (id: UniqueIdentifier) => places.byId.get(Number(id))?.parentId,
    [places],
  );
  const nameOf = (id: UniqueIdentifier) => places.byId.get(Number(id))?.name ?? "The location";

  // With the keyboard, an arrow key takes a picked-up location to the next one beside it, past
  // whatever is inside that one. It's put at that one's middle, so it is the closest whatever the
  // two heights are.
  const byKeys = useMemo<{
    coordinateGetter: KeyboardCoordinateGetter;
    scrollBehavior: ScrollBehavior;
  }>(
    () => ({
      // The page follows a location carried past its edge at once, not in a glide the next key
      // press could overtake.
      scrollBehavior: "auto",
      coordinateGetter: (event, { context: { active, over, collisionRect, droppableRects } }) => {
        const step = event.code === "ArrowDown" ? 1 : event.code === "ArrowUp" ? -1 : 0;
        if (!step) return undefined;
        event.preventDefault();
        const parentId = active ? parentOf(active.id) : undefined;
        if (!active || !collisionRect || parentId === undefined) return undefined;
        const ids = inside(parentId).map((row) => row.id);
        const next = ids.indexOf(Number(over?.id ?? active.id)) + step;
        const target = droppableRects.get(ids[Math.min(Math.max(next, 0), ids.length - 1)]);
        if (!target) return undefined;
        return {
          x: collisionRect.left,
          y: target.top + (target.height - collisionRect.height) / 2,
        };
      },
    }),
    [inside, parentOf],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, AFTER_A_NUDGE),
    useSensor(KeyboardSensor, byKeys),
  );

  // Only the locations beside the one being dragged are places to drop it.
  const besideIt: CollisionDetection = (args) =>
    closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) => parentOf(container.id) === parentOf(args.active.id),
      ),
    });

  async function drop({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const parentId = parentOf(active.id);
    if (parentId === undefined || parentOf(over.id) !== parentId) return;
    const before = inside(parentId).map((row) => row.id);
    const order = {
      parentId,
      ids: arrayMove(before, before.indexOf(Number(active.id)), before.indexOf(Number(over.id))),
    };
    setDropped(order);
    setError(null);
    const res = await api.locations.order.$put({ json: { ids: order.ids } });
    if (!res.ok) setError(await getErrorMessage(res));
    await reload();
    // Unless another drop has taken its place since.
    setDropped((current) => (current === order ? null : current));
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)} is at the place of ${nameOf(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(active.id)} was put at the place of ${nameOf(over.id)}.` : undefined,
    onDragCancel: ({ active }) => `${nameOf(active.id)} was put back.`,
  };

  const tree: Tree = {
    places,
    inside,
    open,
    toggle,
    onAdd: (parent) => {
      setAdding(parent);
      setOpen((current) => new Set(current).add(parent.id));
    },
    onEdit: setEditing,
  };

  return (
    <Card title="Locations">
      <p className="mb-3 text-sm text-secondary-500">
        Where parts are kept, as a tree: a room, what's in it, and so on, up to {MAX_DEPTH} levels.
        Drag a location by its handle to put it in order among the ones beside it. Titles that say
        what's kept in a place are set on the Locations page.
        {places.locations.length > 0 && ` ${count(places.locations.length, "location")} so far.`}
      </p>
      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      )}
      {inside(null).length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={besideIt}
          modifiers={[upAndDown]}
          onDragEnd={(event) => void drop(event)}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                "To move a location, press space or enter, use the up and down arrow keys, then press space or enter again to put it down. Press escape to put it back.",
            },
          }}
        >
          <Level parentId={null} tree={tree} className="mb-3" />
        </DndContext>
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
