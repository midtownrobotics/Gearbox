import { useId } from "react";
import { focusRing } from "./focus";

/**
 * An on/off switch on its own, for a row that already says what it switches. Name it with `label`
 * (read aloud, not shown) or `aria-labelledby`.
 */
export function Switch({
  checked,
  label,
  disabled,
  onChange,
  className = "",
  ...named
}: {
  checked: boolean;
  label?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      {...named}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 shrink-0 rounded-full transition-colors disabled:opacity-60 ${focusRing} ${checked ? "bg-primary-500" : "bg-secondary-300"} ${className}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-surface shadow transition-transform ${checked ? "translate-x-4" : ""}`}
      />
    </button>
  );
}

/** An on/off switch with a label and description, for a setting that takes effect at once. */
export function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className={`flex items-start gap-3 ${disabled ? "opacity-60" : ""}`}>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        className="mt-0.5 disabled:opacity-100"
      />
      <div>
        <span id={`${id}-label`} className="block font-medium text-secondary-900">
          {label}
        </span>
        <span id={`${id}-description`} className="block text-sm text-secondary-500">
          {description}
        </span>
      </div>
    </div>
  );
}
