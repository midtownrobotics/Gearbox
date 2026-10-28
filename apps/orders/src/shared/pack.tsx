import { TextField, inputClass } from "@g3/ui";
import { COMMON_UNITS, MAX_UNIT, formatQuantity } from "@g3/worker-orders/pack-quantity";
import { useId } from "react";
import { QuantityInput } from "./quantity";

export { formatQuantity, sameUnit, unitName } from "@g3/worker-orders/pack-quantity";

// A pack: how many parts one of what's ordered is (4 for a pack of 4), or an amount in a unit
// (100 ft for a spool), which is what the Inventory app counts when it arrives. Whole numbers:
// part of a foot is counted in inches.

/** "pack of 4", "pack of 100 ft", or null for one of each. */
export const packLabel = (quantity: number, unit: string) =>
  quantity > 1 || unit ? `pack of ${formatQuantity(quantity, unit)}` : null;

/** What arrives, as Inventory counts it: "8 parts", "200 ft". */
export const amountOf = (n: number, unit: string) =>
  unit ? formatQuantity(n, unit) : `${n} ${n === 1 ? "part" : "parts"}`;

/** The pack's hint: "= 200 ft when it arrives", or null when it's one of each. */
export function packHint(quantity: number | null, pack: number | null, unit: string) {
  if (quantity === null || pack === null || (pack === 1 && !unit)) return null;
  return `= ${amountOf(quantity * pack, unit)} when it arrives`;
}

/** The Pack of box, with the unit beside it ("ft"; empty for one of each). */
export function PackInput({
  quantity,
  unit,
  onQuantity,
  onUnit,
  required,
}: {
  quantity: string;
  unit: string;
  onQuantity: (text: string) => void;
  onUnit: (text: string) => void;
  required?: boolean;
}) {
  const listId = useId();
  return (
    <span className="flex min-w-0 gap-2">
      <QuantityInput
        value={quantity}
        onChange={onQuantity}
        required={required}
        className={`${inputClass} min-w-0 flex-1`}
      />
      <span className="w-20 shrink-0">
        <TextField
          kind="unit"
          list={listId}
          maxLength={MAX_UNIT}
          placeholder="each"
          aria-label="Unit"
          title="What the pack counts: ft, in, kg, sheet. Empty for parts."
          autoComplete="off"
          value={unit}
          onChange={(e) => onUnit(e.target.value)}
        />
        <datalist id={listId}>
          {COMMON_UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </span>
    </span>
  );
}
