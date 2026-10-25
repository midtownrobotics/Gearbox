import { type ButtonHTMLAttributes, type ReactNode, useState } from "react";
import { focusRing } from "./focus";

export type ButtonVariant = "primary" | "secondary" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary-500 text-on-primary hover:bg-primary-600",
  secondary: "bg-surface text-secondary-800 border border-secondary-300 hover:bg-secondary-50",
  danger: "bg-surface text-red-700 border border-red-300 hover:bg-red-50",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-3.5 py-2 text-sm",
  lg: "px-5 py-3 text-base",
};

/** An icon beside the label sits in line with it. */
const SHAPE = "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold";

/** How a button looks, for a link that has to look like one (`<a>`, a router's `Link`). */
export const buttonClass = (variant: ButtonVariant = "primary", size: ButtonSize = "md") =>
  `${SHAPE} ${focusRing} ${SIZES[size]} ${VARIANTS[variant]}`;

/**
 * A button: `primary` for the page's main action (the team's color), `secondary` for the others,
 * `danger` for one that deletes or can't be undone (red, whatever the team's color). `sm` is for
 * a button inside a row or beside a small field, `lg` for a touch screen. `blocked` looks like
 * `disabled` but still takes the click, so the page can say what's missing.
 */
export function Button({
  variant = "primary",
  size = "md",
  blocked = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  blocked?: boolean;
}) {
  return (
    <button
      type="button"
      aria-disabled={blocked || undefined}
      {...props}
      className={`${SHAPE} disabled:opacity-50 ${blocked ? "opacity-50 cursor-not-allowed" : ""} ${focusRing} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    />
  );
}

/**
 * A question asked in the page before something that can't be undone, with the button that does
 * it and the one that doesn't. For a control other than a button that needs a yes (a switch being
 * turned off); a button uses `ConfirmButton`. `children` are other ways out, shown first (a
 * download to take before deleting).
 */
export function ConfirmQuestion({
  question,
  confirmLabel,
  keepLabel = "Keep it",
  size = "md",
  disabled = false,
  onConfirm,
  onKeep,
  children,
}: {
  question: ReactNode;
  confirmLabel: string;
  /** The button that changes nothing, named for what stays. */
  keepLabel?: string;
  size?: ButtonSize;
  disabled?: boolean;
  onConfirm: () => void;
  onKeep: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="basis-full space-y-2 rounded-lg border border-red-300 bg-red-50 p-3">
      <p className="text-sm text-red-800">{question}</p>
      <div className="flex flex-wrap gap-2">
        {children}
        <Button variant="danger" size={size} disabled={disabled} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" size={size} disabled={disabled} onClick={onKeep}>
          {keepLabel}
        </Button>
      </div>
    </div>
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
    <ConfirmQuestion
      question={question}
      confirmLabel={confirmLabel}
      size={size}
      disabled={disabled}
      onConfirm={() => {
        setAsking(false);
        onConfirm();
      }}
      onKeep={() => setAsking(false)}
    />
  );
}
