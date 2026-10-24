import { inputClass } from "@g3/ui";
import type { InputHTMLAttributes } from "react";

// Quantities and pack quantities are whole numbers: the worker refuses anything else, so every box
// for one checks it here first and says so under the box.

/** The most a request's quantity or pack can be. */
export const MAX_QUANTITY = 10_000;

const digits = /^\d+$/;

/**
 * A quantity typed in a box, as a whole number from 1 to `max`, else null. A decimal, "1e2", a
 * comma or a sign is refused, never rounded.
 */
export function parseQuantity(text: string, max = MAX_QUANTITY): number | null {
  const t = text.trim();
  if (!digits.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= max ? n : null;
}

/** What to say under a quantity's box, or null when it's fine. */
export function quantityError(text: string, max = MAX_QUANTITY): string | null {
  if (parseQuantity(text, max) !== null) return null;
  return digits.test(text.trim()) && Number(text) > max
    ? `Enter a whole number up to ${max.toLocaleString("en-US")}`
    : "Enter a whole number";
}

/**
 * A box for a quantity: whole numbers only, with the number pad on phones. A browser gives an
 * empty value for text it can't read as a number, so that shows the same message as a blank box.
 */
export function QuantityInput({
  value,
  onChange,
  max = MAX_QUANTITY,
  className = inputClass,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "max"> & {
  value: string;
  onChange: (text: string) => void;
  max?: number;
}) {
  const invalid = quantityError(value, max) !== null;
  return (
    <input
      {...props}
      type="number"
      inputMode="numeric"
      step={1}
      min={1}
      max={max}
      className={`${className} aria-invalid:border-red-500`}
      aria-invalid={invalid || undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** The message under a quantity's box when it isn't in a `Field`. */
export function QuantityMessage({ value, max }: { value: string; max?: number }) {
  const error = quantityError(value, max);
  return error ? <span className="block text-xs font-medium text-red-700">{error}</span> : null;
}
