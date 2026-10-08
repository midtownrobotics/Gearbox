import { useTeamNames } from "@g3/ui";
import type { InferResponseType } from "hono/client";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { api, getErrorMessage } from "./api";
import { Button, ErrorBanner, Field, inputClass } from "./ui";

// Marking parts received, with where they go in the Inventory app: into storage at a location, or
// straight into use on a robot. Each part has its own location, which starts as where Inventory
// already keeps that part, or where it went the last time it was received. Mentors decide on
// Settings whether a place has to be said. Inventory is optional: when it can't be reached or
// hasn't been set up, receiving works without it.

export type Intake = InferResponseType<typeof api.inventory.$get, 200>;
type Options = NonNullable<Intake["options"]>;
type Location = Options["locations"][number];
type Defaults = InferResponseType<typeof api.inventory.defaults.$post, 200>["defaults"];

let loading: Promise<Intake | null> | null = null;

/** Whether Inventory details are required, and its places. Loaded once per page load. */
export function useIntake(): Intake | null {
  const [intake, setIntake] = useState<Intake | null>(null);
  useEffect(() => {
    let cancelled = false;
    loading ??= api.inventory
      .$get()
      .then(async (res) => (res.ok ? await res.json() : null))
      .catch(() => null);
    void loading.then((loaded) => {
      if (!cancelled) setIntake(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return intake;
}

/** After the setting changes: the next page to ask loads it again. */
export function forgetIntake() {
  loading = null;
}

/** Whether receiving should ask about Inventory: it's required, or Inventory is set up. */
export function asksInventory(intake: Intake | null): boolean {
  return !!intake && (intake.required || (intake.options?.locations.length ?? 0) > 0);
}

export type ReceiveLine = {
  id: number;
  quantity: number;
  /** How many parts one of the quantity is: Inventory counts parts. */
  packQuantity: number;
  title: string;
};

/** How many parts a line is, as Inventory counts them: 1 pack of 4 is 4. */
const partsOf = (line: ReceiveLine) => line.quantity * line.packQuantity;

/** A location as Inventory shows it: its name, with its title when it has one ("A1 - Misc. Electronics"). */
const labelOf = (row: Location) => (row.title ? `${row.name} - ${row.title}` : row.name);

/** A location from the tree, a level at a time: the top-level place, then what's inside it. */
function LocationPicker({
  locations,
  value,
  onChange,
  label,
  emptyLabel = "Pick a location…",
}: {
  locations: Location[];
  value: number | null;
  onChange: (id: number | null) => void;
  /** What the location is for, read out by screen readers. */
  label: string;
  /** The top level's choice for no location. */
  emptyLabel?: string;
}) {
  const byId = new Map(locations.map((row) => [row.id, row]));
  const children = (parentId: number | null) => locations.filter((r) => r.parentId === parentId);
  const path: Location[] = [];
  for (let at = value === null ? undefined : byId.get(value); at && path.length < 8; ) {
    path.unshift(at);
    at = at.parentId === null ? undefined : byId.get(at.parentId);
  }
  const levels = [null, ...path.map((row) => row.id)].filter((id) => children(id).length > 0);
  return (
    <div className="flex flex-wrap gap-1.5">
      {levels.map((parentId, level) => (
        <select
          key={parentId ?? "top"}
          className={`${inputClass} !w-auto min-w-0 max-w-full flex-1 basis-40 !py-1.5`}
          aria-label={level === 0 ? label : `${label}, inside ${path[level - 1]?.name}`}
          value={path[level]?.id ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : parentId)}
        >
          <option value="">{level === 0 ? emptyLabel : "(right here)"}</option>
          {children(parentId).map((row) => (
            <option key={row.id} value={row.id}>
              {labelOf(row)}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}

/**
 * The pop-up for marking `lines` received. `onReceived` gets how many were, and whether they went
 * into Inventory.
 */
export function ReceiveDialog({
  lines,
  intake,
  onClose,
  onReceived,
}: {
  lines: ReceiveLine[];
  intake: Intake;
  onClose: () => void;
  onReceived: (result: { received: number; toInventory: boolean }) => void;
}) {
  const titleId = useId();
  const inventoryName = useTeamNames().appTitle("Inventory");
  const options = intake.options;
  const usable = !!options && options.locations.length > 0;
  const many = lines.length > 1;
  const [send, setSend] = useState(intake.required || usable);
  const [inUse, setInUse] = useState(false);
  const [robotId, setRobotId] = useState<number | null>(
    options?.robots.length === 1 ? options.robots[0].id : null,
  );
  const [subsystemId, setSubsystemId] = useState<number | null>(null);
  /** Each part's own location, where it has one. */
  const [places, setPlaces] = useState<Record<number, number | null>>({});
  /** Where the parts without a location of their own go. */
  const [restId, setRestId] = useState<number | null>(null);
  const [defaults, setDefaults] = useState<Defaults>({});
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Parts whose location was picked by hand: a default arriving late doesn't replace those. */
  const touched = useRef(new Set<number>());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Where each part starts: with its entry in Inventory, or where it went last time. A part
  // with neither starts blank.
  const ids = lines.map((line) => line.id).join(",");
  useEffect(() => {
    if (!usable || !options) return;
    let cancelled = false;
    api.inventory.defaults
      .$post({ json: { ids: ids.split(",").map(Number) } })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const found = (await res.json()).defaults;
        // A place Inventory no longer has isn't offered.
        const known = new Set(options.locations.map((row) => row.id));
        const usableDefaults: Defaults = {};
        for (const [id, value] of Object.entries(found)) {
          if (known.has(value.locationId)) usableDefaults[id] = value;
        }
        setDefaults(usableDefaults);
        setPlaces((current) => {
          const next = { ...current };
          for (const [id, value] of Object.entries(usableDefaults)) {
            if (!touched.current.has(Number(id))) next[Number(id)] = value.locationId;
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ids, usable, options]);

  /** Why the parts can't go into Inventory at all, when they must. */
  const blocked = !usable
    ? options
      ? `${inventoryName} has no locations yet. An admin sets them up on its Settings page.`
      : `${inventoryName} can't be reached right now.`
    : null;
  const canUse = !!options && options.robots.length > 0 && options.subsystems.length > 0;

  function pickPlace(id: number, locationId: number | null) {
    touched.current.add(id);
    setPlaces((current) => ({ ...current, [id]: locationId }));
  }

  async function receive(e: FormEvent) {
    e.preventDefault();
    let inventory = null;
    if (send) {
      if (blocked) return setError(blocked);
      if (inUse && (robotId === null || subsystemId === null)) {
        return setError("Pick the robot and subsystem.");
      }
      const locations: Record<string, number> = {};
      const changed: Record<string, number> = {};
      for (const line of lines) {
        const own = places[line.id] ?? null;
        if (own !== null) locations[line.id] = own;
        else if (restId === null) return setError(`Pick where “${line.title}” goes.`);
        const text = quantities[line.id];
        if (text === undefined || text.trim() === "") continue;
        const n = Number(text);
        if (!Number.isInteger(n) || n < 1) {
          return setError("Quantities going into Inventory must be whole numbers, 1 or more.");
        }
        if (n !== partsOf(line)) changed[line.id] = n;
      }
      inventory = {
        status: inUse ? ("in_use" as const) : ("storage" as const),
        locationId: restId,
        locations,
        robotId: inUse ? robotId : null,
        subsystemId: inUse ? subsystemId : null,
        quantities: changed,
      };
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.orders.receive.$post({
        json: { ids: lines.map((line) => line.id), inventory },
      });
      if (!res.ok) return setError(await getErrorMessage(res));
      const body = await res.json();
      onReceived({ received: body.received.length, toInventory: body.inventoryAdded !== null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const pick = (
    label: string,
    list: { id: number; name: string }[],
    value: number | null,
    onPick: (id: number | null) => void,
  ) => (
    <Field label={label}>
      <select
        className={inputClass}
        value={value ?? ""}
        onChange={(e) => onPick(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Pick one…</option>
        {list.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>
    </Field>
  );

  /** Why a part's location is what it is, when it's the one it started with. */
  function reason(line: ReceiveLine): string | null {
    const start = defaults[line.id];
    if (!start || places[line.id] !== start.locationId) return null;
    return start.from === "entry"
      ? `With ${start.entryName ? `“${start.entryName}”` : "the ones"} already in ${inventoryName}.`
      : "Where it went last time.";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-secondary-900/50 p-4 sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-xl rounded-xl bg-surface shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-secondary-200 px-5 py-3">
          <h2 id={titleId} className="text-lg font-semibold text-secondary-900">
            {many ? `Mark ${lines.length} items received` : "Mark received"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-secondary-400 hover:text-secondary-900"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <form onSubmit={receive} className="space-y-4 p-5">
          {intake.required ? (
            <p className="text-sm text-secondary-600">
              Say where {many ? "these go" : "this goes"}, so {inventoryName} stays right.
            </p>
          ) : (
            <label className="flex items-center gap-2 text-sm text-secondary-700">
              <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
              Add {many ? "them" : "it"} to {inventoryName}
            </label>
          )}

          {send && blocked && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {blocked}
              {intake.required && " A mentor can turn this requirement off on Orders' Settings."}
            </p>
          )}

          {send && options && usable && (
            <>
              <div className="flex gap-4 text-sm text-secondary-700">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={!inUse} onChange={() => setInUse(false)} />
                  Into storage
                </label>
                <label
                  className={`flex items-center gap-2 ${canUse ? "" : "opacity-50"}`}
                  title={
                    canUse ? undefined : `No robots or subsystems are set up in ${inventoryName}`
                  }
                >
                  <input
                    type="radio"
                    checked={inUse}
                    disabled={!canUse}
                    onChange={() => setInUse(true)}
                  />
                  Straight into use
                </label>
              </div>
              {inUse && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {pick("Robot", options.robots, robotId, setRobotId)}
                  {pick("Subsystem", options.subsystems, subsystemId, setSubsystemId)}
                </div>
              )}

              <div>
                <p className="text-sm font-medium text-secondary-700">
                  How many parts, and where {many ? "each goes" : "they go"}
                </p>
                <p className="text-xs text-secondary-500">
                  Packs count as the parts in them. Edit a number if it isn't what arrived.
                </p>
                <ul className="mt-2 max-h-80 divide-y divide-secondary-100 overflow-y-auto rounded-lg border border-secondary-200">
                  {lines.map((line) => {
                    const why = reason(line);
                    return (
                      <li key={line.id} className="space-y-1.5 px-3 py-2">
                        <div className="flex items-center gap-3 text-sm">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            step={1}
                            aria-label={`Parts of ${line.title}`}
                            className={`${inputClass} !w-20 !py-1`}
                            value={quantities[line.id] ?? String(partsOf(line))}
                            onChange={(e) =>
                              setQuantities({ ...quantities, [line.id]: e.target.value })
                            }
                          />
                          <span
                            className="min-w-0 flex-1 truncate text-secondary-900"
                            title={line.title}
                          >
                            {line.title}
                            {line.packQuantity > 1 && (
                              <span className="text-secondary-500">
                                {" "}
                                ({line.quantity} × pack of {line.packQuantity})
                              </span>
                            )}
                          </span>
                        </div>
                        <LocationPicker
                          locations={options.locations}
                          value={places[line.id] ?? null}
                          onChange={(locationId) => pickPlace(line.id, locationId)}
                          label={`Location for ${line.title}`}
                          emptyLabel={many ? "Same as the rest (below)" : "Pick a location…"}
                        />
                        {why && <p className="text-xs text-secondary-500">{why}</p>}
                      </li>
                    );
                  })}
                </ul>
              </div>

              {many && (
                <Field
                  label="The rest go to"
                  hint="For parts above that don't have a place of their own."
                >
                  <LocationPicker
                    locations={options.locations}
                    value={restId}
                    onChange={setRestId}
                    label="Location for the rest"
                  />
                </Field>
              )}
            </>
          )}

          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || (send && intake.required && !!blocked)}>
              {busy ? "Saving…" : "Received"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
