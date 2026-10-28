import { TextField } from "@g3/ui";
import { COMMON_UNITS, MAX_UNIT, sameUnit, unitAfter } from "@g3/worker-inventory/units";
import { useId, useMemo } from "react";
import { useInventory } from "./inventory-data";

export { formatQuantity, sameUnit, unitAfter, unitName } from "@g3/worker-inventory/units";

// What an entry's quantity counts: "ft", "sheet", or "" for one of each. Quantities stay whole
// numbers, so a team that needs part of one counts in a smaller unit.

/** The units offered when one is typed: the team's own list, the ones its entries use, the common ones. */
export function useUnitSuggestions(): string[] {
  const { units, items } = useInventory();
  return useMemo(() => {
    const out: string[] = [];
    const add = (unit: string) => {
      if (unit && !out.some((have) => sameUnit(have, unit))) out.push(unit);
    };
    for (const unit of units) add(unit.name);
    for (const item of items) add(item.unit);
    for (const unit of COMMON_UNITS) add(unit);
    return out;
  }, [units, items]);
}

/** The box an entry's unit is typed in, offering the team's units and the common ones. */
export function UnitField({
  value,
  onChange,
  id,
}: { value: string; onChange: (value: string) => void; id?: string }) {
  const listId = useId();
  const suggestions = useUnitSuggestions();
  return (
    <>
      <TextField
        id={id}
        kind="unit"
        list={listId}
        maxLength={MAX_UNIT}
        placeholder="each"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {suggestions.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>
    </>
  );
}

/**
 * The unit after a number ("ft" after 12, "sheets" after 3), small and cut short if it's long, so
 * it never pushes a row sideways. Nothing for one of each.
 */
export function UnitSuffix({
  n,
  unit,
  className = "max-w-16",
}: { n: number; unit: string; className?: string }) {
  if (!unit) return null;
  const text = unitAfter(n, unit);
  return (
    <span className={`min-w-0 truncate text-xs text-secondary-500 ${className}`} title={text}>
      {text}
    </span>
  );
}
