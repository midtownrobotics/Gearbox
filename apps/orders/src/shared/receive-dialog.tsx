import { useTeamNames } from "@g3/ui";
import type { InferResponseType } from "hono/client";
import { type FormEvent, useEffect, useId, useState } from "react";
import { api, getErrorMessage } from "./api";
import { Button, ErrorBanner, Field, inputClass } from "./ui";

// Marking parts received, with where they go in the Inventory app: into storage at a location, or
// straight into use on a robot. Mentors decide on Settings whether that has to be said. Inventory
// is optional: when it can't be reached or hasn't been set up, receiving works without it.

export type Intake = InferResponseType<typeof api.inventory.$get, 200>;
type Options = NonNullable<Intake["options"]>;
type Location = Options["locations"][number];

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

/** A location from the tree, a level at a time: the top-level place, then what's inside it. */
function LocationPicker({
  locations,
  value,
  onChange,
}: { locations: Location[]; value: number | null; onChange: (id: number | null) => void }) {
  const byId = new Map(locations.map((row) => [row.id, row]));
  const children = (parentId: number | null) => locations.filter((r) => r.parentId === parentId);
  const path: Location[] = [];
  for (let at = value === null ? undefined : byId.get(value); at && path.length < 8; ) {
    path.unshift(at);
    at = at.parentId === null ? undefined : byId.get(at.parentId);
  }
  const levels = [null, ...path.map((row) => row.id)].filter((id) => children(id).length > 0);
  return (
    <div className="space-y-1.5">
      {levels.map((parentId, level) => (
        <select
          key={parentId ?? "top"}
          className={inputClass}
          aria-label={level === 0 ? "Location" : `Location, inside ${path[level - 1]?.name}`}
          value={path[level]?.id ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : parentId)}
        >
          <option value="">{level === 0 ? "Pick a location…" : "(right here)"}</option>
          {children(parentId).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
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
  const [send, setSend] = useState(intake.required || usable);
  const [inUse, setInUse] = useState(false);
  const [locationId, setLocationId] = useState<number | null>(null);
  const [robotId, setRobotId] = useState<number | null>(
    options?.robots.length === 1 ? options.robots[0].id : null,
  );
  const [subsystemId, setSubsystemId] = useState<number | null>(null);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Why the parts can't go into Inventory at all, when they must. */
  const blocked = !usable
    ? options
      ? `${inventoryName} has no locations yet. An admin sets them up on its Settings page.`
      : `${inventoryName} can't be reached right now.`
    : null;
  const canUse = !!options && options.robots.length > 0 && options.subsystems.length > 0;

  async function receive(e: FormEvent) {
    e.preventDefault();
    let inventory = null;
    if (send) {
      if (blocked) return setError(blocked);
      if (locationId === null) return setError("Pick where the parts go.");
      if (inUse && (robotId === null || subsystemId === null)) {
        return setError("Pick the robot and subsystem.");
      }
      const changed: Record<string, number> = {};
      for (const line of lines) {
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
        locationId,
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-secondary-900/50 p-4 sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-secondary-200 px-5 py-3">
          <h2 id={titleId} className="text-lg font-semibold text-secondary-900">
            {lines.length === 1 ? "Mark received" : `Mark ${lines.length} items received`}
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
              Say where {lines.length === 1 ? "this goes" : "these go"}, so {inventoryName} stays
              right.
            </p>
          ) : (
            <label className="flex items-center gap-2 text-sm text-secondary-700">
              <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
              Add {lines.length === 1 ? "it" : "them"} to {inventoryName}
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
              <Field label={inUse ? "Location" : "Storage location"}>
                <LocationPicker
                  locations={options.locations}
                  value={locationId}
                  onChange={setLocationId}
                />
              </Field>
              <div>
                <p className="text-sm font-medium text-secondary-700">How many parts</p>
                <p className="text-xs text-secondary-500">
                  Packs are counted as the parts in them. Change a number if that isn't what
                  arrived.
                </p>
                <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
                  {lines.map((line) => (
                    <li key={line.id} className="flex items-center gap-3 text-sm">
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
                    </li>
                  ))}
                </ul>
              </div>
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
