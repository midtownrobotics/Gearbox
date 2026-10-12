import { type ReactNode, useEffect, useId } from "react";
import { focusRing } from "./focus";

/** A pop-up over the page, closed by ✕, Escape or its own buttons. */
export function Dialog({
  title,
  onClose,
  wide = false,
  children,
}: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
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
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl bg-surface shadow-xl`}
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
