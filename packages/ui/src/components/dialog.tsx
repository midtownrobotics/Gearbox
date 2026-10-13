import { type ReactNode, useEffect, useId } from "react";
import { focusRing } from "./focus";

/** How wide a pop-up may grow: a question, a short form, a list, or a form with columns. */
export type DialogSize = "md" | "xl" | "2xl" | "3xl";

const SIZES: Record<DialogSize, string> = {
  md: "max-w-md",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
};

/**
 * A pop-up over the page, closed by ✕, Escape or its own buttons. `wide` is `size="2xl"`.
 */
export function Dialog({
  title,
  onClose,
  wide = false,
  size = wide ? "2xl" : "md",
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  size?: DialogSize;
  children: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-secondary-900/50 p-4 sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full ${SIZES[size]} rounded-xl bg-surface shadow-xl`}
      >
        <header className="flex items-center justify-between border-b border-secondary-200 px-5 py-3">
          <h2 id={titleId} className="text-lg font-semibold text-secondary-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-2 py-1 text-secondary-400 hover:text-secondary-900 ${focusRing}`}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="space-y-4 p-5">{children}</div>
      </div>
    </div>
  );
}
