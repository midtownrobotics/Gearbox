import { useId } from "react";

/** An on/off switch with a label and description. */
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
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 relative w-10 h-6 shrink-0 rounded-full transition-colors ${checked ? "bg-primary-500" : "bg-secondary-300"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-surface shadow transition-transform ${checked ? "translate-x-4" : ""}`}
        />
      </button>
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
