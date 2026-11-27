// SPDX-License-Identifier: AGPL-3.0-only
import type { ItemView, StockView } from "@g3/worker-inventory";
import { useEffect, useRef, useState } from "react";
import { api, getErrorMessage } from "./api";
import { useInventory } from "./inventory-data";
import { isStep, parseQuantity, quantityPatch } from "./quantity-edit";
import { AddStockDialog, CheckInDialog, CheckOutDialog, MoveDialog } from "./stock-dialogs";
import { UnitSuffix } from "./units";

// The parts of a stock row that can be changed where it's shown (the main table and an entry's
// page): its quantity, its location, and checking it out or in.

/**
 * A row's quantity, changed in place: type the number and press Enter (or click away), or step it
 * with the up/down arrows, which saves shortly after the last step. That's recorded as a count,
 * with who counted. `unit` is the entry's, shown after the box. `compact`: a narrower box, for a
 * phone.
 */
export function QuantityCell({
  stock,
  unit,
  onSaved,
  compact = false,
}: { stock: StockView; unit: string; onSaved?: () => void; compact?: boolean }) {
  const { reload } = useInventory();
  const [text, setText] = useState(String(stock.quantity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);

  useEffect(() => setText(String(stock.quantity)), [stock.quantity]);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  function cancelTimer() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }

  async function writeQuantity(n: number) {
    if (n === stock.quantity || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await api.stock[":id"].$patch({
        param: { id: String(stock.id) },
        json: { quantity: n },
      });
      if (!res.ok) {
        setError(await getErrorMessage(res));
        return;
      }
      await reload();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleChange(next: string, input: HTMLInputElement, inputType: string | undefined) {
    setText(next);
    cancelTimer();
    // Typing waits for Enter or blur, so a half-typed number is never saved. A step is saved
    // shortly after the last one: a click on Firefox's arrows doesn't focus the box, so no blur
    // would follow it.
    if (!isStep(inputType) && document.activeElement === input) return;
    const patch = quantityPatch(parseQuantity(next), stock.quantity);
    if (patch.kind !== "save") return;
    setError(null);
    const n = patch.quantity;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void writeQuantity(n);
    }, 400);
  }

  function saveNow() {
    cancelTimer();
    const patch = quantityPatch(parseQuantity(text), stock.quantity);
    if (patch.kind === "error") {
      setError("Enter a whole number, 0 or more.");
      return;
    }
    if (patch.kind === "save") void writeQuantity(patch.quantity);
  }

  return (
    <span className="inline-flex flex-col items-start">
      <span className="inline-flex max-w-full items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          aria-label="Quantity"
          title="Type what's there and press Enter, or use the arrows, to record a count"
          className={`${compact ? "w-16" : "w-20"} rounded-md border bg-surface px-2 py-1 text-sm tabular-nums text-secondary-900 focus:outline-none focus:border-primary-500 ${
            error ? "border-red-500" : "border-secondary-200 hover:border-secondary-400"
          }`}
          // Read-only rather than disabled while saving, so the box keeps the focus.
          readOnly={busy}
          aria-busy={busy}
          value={text}
          onChange={(e) =>
            handleChange(
              e.target.value,
              e.currentTarget,
              (e.nativeEvent as Partial<InputEvent>).inputType,
            )
          }
          onBlur={saveNow}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelTimer();
              setText(String(stock.quantity));
              setError(null);
            }
          }}
        />
        <UnitSuffix n={stock.quantity} unit={unit} className={compact ? "max-w-10" : "max-w-16"} />
      </span>
      {error && (
        <span className={`mt-0.5 text-xs text-red-700 ${compact ? "max-w-16" : "max-w-40"}`}>
          {error}
        </span>
      )}
    </span>
  );
}

export type StockAction = {
  kind: "out" | "in" | "move" | "add";
  item: ItemView;
  /** The row acted on; not needed to add parts. */
  stock?: StockView;
};

/** The pop-up for an action picked on a row, if one is open. */
export function StockActionDialog({
  action,
  onClose,
  onDone,
}: { action: StockAction | null; onClose: () => void; onDone?: () => void }) {
  if (!action) return null;
  const { kind, item, stock } = action;
  if (kind === "add" || !stock) {
    return <AddStockDialog item={item} onClose={onClose} onDone={onDone} />;
  }
  const props = { item, stock, onClose, onDone };
  if (kind === "out") return <CheckOutDialog {...props} />;
  if (kind === "in") return <CheckInDialog {...props} />;
  return <MoveDialog {...props} />;
}

const linkButton =
  "text-left text-sm text-secondary-900 underline decoration-secondary-300 decoration-dotted underline-offset-4 hover:decoration-primary-500 hover:text-primary-700";

/** A row's location, as a button that opens the pop-up to change it. */
export function LocationButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={linkButton} title="Change location" onClick={onClick}>
      {label || "Unknown location"}
    </button>
  );
}

/** "Check out" on parts in storage, "Check in" on parts in use. */
export function CheckButton({
  stock,
  onPick,
}: { stock: StockView; onPick: (kind: "out" | "in") => void }) {
  if (stock.quantity === 0) return null;
  const out = stock.status === "storage";
  return (
    <button
      type="button"
      onClick={() => onPick(out ? "out" : "in")}
      className={`whitespace-nowrap rounded-lg px-3 py-1 text-sm font-semibold ${
        out
          ? "bg-primary-500 text-on-primary hover:bg-primary-600"
          : "border border-secondary-300 bg-surface text-secondary-800 hover:bg-secondary-50"
      }`}
    >
      {out ? "Check out" : "Check in"}
    </button>
  );
}
