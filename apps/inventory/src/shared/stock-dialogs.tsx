import type { ItemView, StockView } from "@g3/worker-inventory";
import { type FormEvent, type ReactNode, useState } from "react";
import { api, getErrorMessage } from "./api";
import { useInventory } from "./inventory-data";
import { LocationPicker } from "./location-picker";
import { type Places, locationLabel, useLabel } from "./places";
import { Button, Dialog, ErrorBanner, Field, inputClass } from "./ui";

// The pop-ups for moving parts around: check out (storage → in use on a robot), check in (back to
// storage), move (somewhere else, as they are) and add (parts that weren't counted before).

type Response = { ok: boolean; status: number; json(): Promise<unknown> };

/** A pop-up form: runs `submit`, shows what went wrong, and reloads the inventory when it worked. */
function StockForm({
  title,
  action,
  problem,
  submit,
  onClose,
  onDone,
  children,
}: {
  title: string;
  /** The button's label. */
  action: string;
  /** Why the form can't be sent yet, if it can't. */
  problem: string | null;
  submit: () => Promise<Response>;
  onClose: () => void;
  onDone?: () => void;
  children: ReactNode;
}) {
  const { reload } = useInventory();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const res = await submit();
      if (!res.ok) return setError(await getErrorMessage(res));
      await reload();
      onDone?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={send} className="space-y-4">
        {children}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : action}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function QuantityField({
  label,
  value,
  onChange,
  max,
  min = 1,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  min?: number;
}) {
  return (
    <Field label={label} hint={max === undefined ? undefined : `${max} there now`}>
      <input
        className={inputClass}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** A whole number in range from a quantity input, or null. */
function quantityOf(text: string, min: number, max = 1_000_000): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** The robot and subsystem parts are in use on. */
function UseFields({
  places,
  robotId,
  subsystemId,
  onRobot,
  onSubsystem,
}: {
  places: Places;
  robotId: number | null;
  subsystemId: number | null;
  onRobot: (id: number | null) => void;
  onSubsystem: (id: number | null) => void;
}) {
  if (places.robots.length === 0 || places.subsystems.length === 0) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        No robots or subsystems yet. An admin adds them on Settings.
      </p>
    );
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
        required
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
    <div className="grid gap-4 sm:grid-cols-2">
      {pick("Robot", places.robots, robotId, onRobot)}
      {pick("Subsystem", places.subsystems, subsystemId, onSubsystem)}
    </div>
  );
}

function Summary({ item, stock }: { item: ItemView; stock: StockView }) {
  const { places } = useInventory();
  const use = useLabel(stock, places);
  return (
    <p className="text-sm text-secondary-600">
      <span className="font-semibold text-secondary-900">{item.name}</span>
      <br />
      {stock.quantity} in {locationLabel(stock.locationId, places) || "an unknown location"}
      {use && `, in use on ${use}`}
    </p>
  );
}

/**
 * Where an entry is kept in storage: its first storage row with parts in it (the first one the
 * table shows), else the empty row that remembers where it lives. Undefined if it has neither.
 */
function storageHome(item: ItemView): StockView | undefined {
  const storage = item.stock.filter((row) => row.status === "storage");
  return storage.find((row) => row.quantity > 0) ?? storage[0];
}

type RowProps = { item: ItemView; stock: StockView; onClose: () => void; onDone?: () => void };

/** Puts some of a storage row in use: how many, on what, and where they'll be. */
export function CheckOutDialog({ item, stock, onClose, onDone }: RowProps) {
  const { places } = useInventory();
  const [quantity, setQuantity] = useState("1");
  const [locationId, setLocationId] = useState<number | null>(stock.locationId);
  const [robotId, setRobotId] = useState<number | null>(
    places.robots.length === 1 ? places.robots[0].id : null,
  );
  const [subsystemId, setSubsystemId] = useState<number | null>(null);
  const n = quantityOf(quantity, 1, stock.quantity);
  const problem =
    n === null
      ? `Enter a quantity from 1 to ${stock.quantity}.`
      : locationId === null
        ? "Pick a location."
        : robotId === null || subsystemId === null
          ? "Pick the robot and subsystem."
          : null;
  return (
    <StockForm
      title="Check out"
      action="Check out"
      problem={problem}
      onClose={onClose}
      onDone={onDone}
      submit={() =>
        api.stock[":id"]["check-out"].$post({
          param: { id: String(stock.id) },
          json: {
            quantity: n as number,
            locationId: locationId as number,
            robotId: robotId as number,
            subsystemId: subsystemId as number,
          },
        })
      }
    >
      <Summary item={item} stock={stock} />
      <QuantityField
        label="How many to put in use"
        value={quantity}
        onChange={setQuantity}
        max={stock.quantity}
      />
      <UseFields
        places={places}
        robotId={robotId}
        subsystemId={subsystemId}
        onRobot={setRobotId}
        onSubsystem={setSubsystemId}
      />
      <Field label="Location" hint="Leave it to keep their place.">
        <LocationPicker places={places} value={locationId} onChange={setLocationId} />
      </Field>
    </StockForm>
  );
}

/**
 * Brings some of an in-use row back to storage: how many, and where they go. Preset to go back
 * with the rest of the entry's parts in storage, so they join that row; with none in storage,
 * to stay where they are.
 */
export function CheckInDialog({ item, stock, onClose, onDone }: RowProps) {
  const { places } = useInventory();
  const home = storageHome(item);
  const [quantity, setQuantity] = useState(String(stock.quantity));
  const [locationId, setLocationId] = useState<number | null>(home?.locationId ?? stock.locationId);
  const n = quantityOf(quantity, 1, stock.quantity);
  const problem =
    n === null
      ? `Enter a quantity from 1 to ${stock.quantity}.`
      : locationId === null
        ? "Pick a location."
        : null;
  return (
    <StockForm
      title="Check in"
      action="Check in"
      problem={problem}
      onClose={onClose}
      onDone={onDone}
      submit={() =>
        api.stock[":id"]["check-in"].$post({
          param: { id: String(stock.id) },
          json: { quantity: n as number, locationId: locationId as number },
        })
      }
    >
      <Summary item={item} stock={stock} />
      <QuantityField
        label="How many to put back in storage"
        value={quantity}
        onChange={setQuantity}
        max={stock.quantity}
      />
      <Field
        label="Storage location"
        hint={
          home && locationId === home.locationId
            ? home.quantity > 0
              ? `Back with the ${home.quantity} already in storage there.`
              : "Back where this entry is kept."
            : undefined
        }
      >
        <LocationPicker places={places} value={locationId} onChange={setLocationId} />
      </Field>
    </StockForm>
  );
}

/** Moves a whole row somewhere else, as it is (still in storage, or still in use). */
export function MoveDialog({ item, stock, onClose, onDone }: RowProps) {
  const { places } = useInventory();
  const [locationId, setLocationId] = useState<number | null>(stock.locationId);
  return (
    <StockForm
      title="Change location"
      action="Move"
      problem={locationId === null ? "Pick a location." : null}
      onClose={onClose}
      onDone={onDone}
      submit={() =>
        api.stock[":id"].$patch({
          param: { id: String(stock.id) },
          json: { locationId: locationId as number },
        })
      }
    >
      <Summary item={item} stock={stock} />
      <Field label="New location">
        <LocationPicker places={places} value={locationId} onChange={setLocationId} />
      </Field>
    </StockForm>
  );
}

/**
 * Adds parts to an entry that weren't counted before, in storage or straight into use. With a
 * quantity of 0 in storage, it only says where the entry is kept.
 */
export function AddStockDialog({
  item,
  onClose,
  onDone,
}: { item: ItemView; onClose: () => void; onDone?: () => void }) {
  const { places } = useInventory();
  const home = storageHome(item);
  const [quantity, setQuantity] = useState("");
  const [inUse, setInUse] = useState(false);
  const [locationId, setLocationId] = useState<number | null>(home?.locationId ?? null);
  const [robotId, setRobotId] = useState<number | null>(null);
  const [subsystemId, setSubsystemId] = useState<number | null>(null);
  const n = quantityOf(quantity, inUse ? 1 : 0);
  const problem =
    n === null
      ? "Enter a whole number."
      : locationId === null
        ? "Pick a location."
        : inUse && (robotId === null || subsystemId === null)
          ? "Pick the robot and subsystem."
          : null;
  return (
    <StockForm
      title="Add parts"
      action="Add"
      problem={problem}
      onClose={onClose}
      onDone={onDone}
      submit={() =>
        api.items[":id"].stock.$post({
          param: { id: String(item.id) },
          json: {
            quantity: n as number,
            locationId: locationId as number,
            status: inUse ? "in_use" : "storage",
            robotId: inUse ? (robotId as number) : null,
            subsystemId: inUse ? (subsystemId as number) : null,
          },
        })
      }
    >
      <p className="text-sm text-secondary-600">
        <span className="font-semibold text-secondary-900">{item.name}</span>
        <br />
        For parts that were found, donated or made. To fix a count, edit the quantity in the table.
      </p>
      <QuantityField label="How many" value={quantity} onChange={setQuantity} min={0} />
      <div className="flex gap-4 text-sm text-secondary-700">
        <label className="flex items-center gap-2">
          <input type="radio" checked={!inUse} onChange={() => setInUse(false)} />
          In storage
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={inUse} onChange={() => setInUse(true)} />
          In use
        </label>
      </div>
      {inUse && (
        <UseFields
          places={places}
          robotId={robotId}
          subsystemId={subsystemId}
          onRobot={setRobotId}
          onSubsystem={setSubsystemId}
        />
      )}
      <Field label="Location">
        <LocationPicker places={places} value={locationId} onChange={setLocationId} />
      </Field>
    </StockForm>
  );
}
