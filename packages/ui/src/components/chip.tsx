import type { ButtonHTMLAttributes } from "react";
import { focusRing } from "./focus";

/**
 * One choice in a row of filters. The chosen one is near-black, so the team's color stays for the
 * page's main action.
 */
export function Chip({
  selected,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...props}
      className={`rounded-full border px-3 py-1 text-sm font-medium ${focusRing} ${
        selected
          ? "bg-secondary-900 text-white border-secondary-900"
          : "bg-surface text-secondary-600 border-secondary-300 hover:border-secondary-500"
      } ${className}`}
    />
  );
}
