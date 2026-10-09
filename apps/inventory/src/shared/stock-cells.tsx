import type { ItemView, StockView } from "@g3/worker-inventory";
import { useEffect, useState } from "react";
import { api, getErrorMessage } from "./api";
import { useInventory } from "./inventory-data";
import { AddStockDialog, CheckInDialog, CheckOutDialog, MoveDialog } from "./stock-dialogs";

// The parts of a stock row that can be changed where it's shown (the main table and an entry's
// page): its quantity, its location, and checking it out or in.

/**
 * A row's quantity, changed in place: type the number that's there and press Enter (or click
 * away). That's recorded as a count, with who counted. `compact`: a narrower box, for a phone.
 */
export function QuantityCell({
  stock,
  onSaved,
  compact = false,
}: { stock: StockView; onSaved?: () => void; compact?: boolean }) {
  const { reload } = useInventory();
  const [text, setText] = useState(String(stock.quantity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setText(String(stock.quantity)), [stock.quantity]);

  async function save() {
    const n = Number(text);
    if (text.trim() === "" || !Number.isInteger(n) || n < 0 || n > 1_000_000) {
      setError("Enter a whole number, 0 or more.");
      return;
    }
    setError(null);
    if (n === stock.quantity) return;
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
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        aria-label="Quantity"
        title="Type what's there and press Enter to record a count"
        className={`${compact ? "w-16" : "w-20"} rounded-md border bg-surface px-2 py-1 text-sm tabular-nums text-secondary-900 focus:outline-none focus:border-primary-500 ${
          error ? "border-primary-400" : "border-secondary-200 hover:border-secondary-400"
        }`}
        disabled={busy}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(String(stock.quantity));
            setError(null);
          }
        }}
      />
      {error && (
        <span className={`mt-0.5 text-xs text-primary-700 ${compact ? "max-w-16" : "max-w-40"}`}>
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
          ? "bg-primary-500 text-white hover:bg-primary-600"
          : "border border-secondary-300 bg-surface text-secondary-800 hover:bg-secondary-50"
      }`}
    >
      {out ? "Check out" : "Check in"}
    </button>
  );
}
