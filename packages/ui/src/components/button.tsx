import { type ButtonHTMLAttributes, useState } from "react";
import { focusRing } from "./focus";

export type ButtonSize = "sm" | "md";

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-3.5 py-2 text-sm",
};

/**
 * A button: `primary` for the page's main action (the team's color), `secondary` for the others,
 * `danger` for one that deletes or can't be undone (red, whatever the team's color). `sm` is for
 * a button inside a row or beside a small field.
 */
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  size?: ButtonSize;
}) {
  const styles = {
    primary: "bg-primary-500 text-on-primary hover:bg-primary-600",
    secondary: "bg-surface text-secondary-800 border border-secondary-300 hover:bg-secondary-50",
    danger: "bg-surface text-red-700 border border-red-300 hover:bg-red-50",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={`rounded-lg font-semibold disabled:opacity-50 ${focusRing} ${SIZES[size]} ${styles} ${className}`}
    />
  );
}

/**
 * A button for something that can't be undone: the first click asks `question` in its place, and
 * the second does it. Asked in the page, not with the browser's own confirm box, which embedded
 * browsers can silently answer "no" to.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel = label,
  size = "md",
  disabled = false,
  onConfirm,
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  size?: ButtonSize;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="danger" size={size} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="basis-full space-y-2 rounded-lg border border-red-300 bg-red-50 p-3">
      <p className="text-sm text-red-800">{question}</p>
      <div className="flex gap-2">
        <Button
          variant="danger"
          size={size}
          disabled={disabled}
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
        <Button
          variant="secondary"
          size={size}
          disabled={disabled}
          onClick={() => setAsking(false)}
        >
          Keep it
        </Button>
      </div>
    </div>
  );
}
