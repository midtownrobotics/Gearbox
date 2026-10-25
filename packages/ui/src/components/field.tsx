import type { ReactNode } from "react";

/** For an `<input>`, `<select>` or `<textarea>`. */
export const inputClass =
  "w-full rounded-lg border border-secondary-300 bg-surface px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30";

/** A control with its label above and a hint below. */
export function Field({
  label,
  hint,
  warn = false,
  error,
  children,
}: {
  label: string;
  hint?: string;
  /** Show the hint as something to check (a guessed value), not just help text. */
  warn?: boolean;
  /** What's wrong with the value, shown in red in place of the hint. */
  error?: string | null;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label className="block min-w-0 space-y-1">
      <span className="block text-sm font-medium text-secondary-700">{label}</span>
      {children}
      {error ? (
        <span className="block text-xs font-medium text-red-700">{error}</span>
      ) : (
        hint && (
          <span
            className={`block text-xs ${warn ? "text-amber-700 font-medium" : "text-secondary-500"}`}
          >
            {hint}
          </span>
        )
      )}
    </label>
  );
}
