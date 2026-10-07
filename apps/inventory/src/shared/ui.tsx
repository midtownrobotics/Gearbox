import { type ReactNode, useEffect, useId, useState } from "react";

export function PageLoading() {
  return (
    <main className="min-h-screen bg-page flex items-center justify-center">
      <p className="text-secondary-400">Loading…</p>
    </main>
  );
}

export function Page({
  title,
  actions,
  wide = false,
  children,
}: {
  title: string;
  actions?: ReactNode;
  /** For pages that are mostly a table or a tree. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="flex-1 bg-page">
      <div className={`${wide ? "max-w-7xl" : "max-w-5xl"} mx-auto px-4 sm:px-6 py-6 space-y-5`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-4xl text-secondary-900">{title}</h1>
          {actions}
        </div>
        {children}
      </div>
    </main>
  );
}

export function Card({
  title,
  children,
  className = "",
}: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-white border border-secondary-200 rounded-xl p-5 ${className}`}>
      {title && (
        <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-400 font-sans mb-3">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="text-primary-700 text-sm bg-primary-50 border border-primary-200 rounded-lg px-4 py-2.5">
      {message}
    </p>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="text-emerald-800 text-sm bg-emerald-50 border border-emerald-300 rounded-lg px-4 py-2.5"
    >
      ✓ {message}
    </p>
  );
}

export function Loading() {
  return <p className="text-secondary-400 text-sm">Loading…</p>;
}

export const inputClass =
  "w-full rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:border-primary-500";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  const styles = {
    primary: "bg-primary-500 text-white hover:bg-primary-600",
    secondary: "bg-white text-secondary-800 border border-secondary-300 hover:bg-secondary-50",
    danger: "bg-white text-primary-700 border border-primary-300 hover:bg-primary-50",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={`rounded-lg px-3.5 py-2 text-sm font-semibold disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: { label: string; hint?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label className="block space-y-1">
      <span className="text-sm font-medium text-secondary-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-secondary-500">{hint}</span>}
    </label>
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
  disabled = false,
  onConfirm,
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="danger" disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="basis-full space-y-2 rounded-lg border border-primary-200 bg-primary-50 p-3">
      <p className="text-sm text-primary-700">{question}</p>
      <div className="flex gap-2">
        <Button
          variant="danger"
          disabled={disabled}
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
        <Button variant="secondary" disabled={disabled} onClick={() => setAsking(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

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
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl bg-white shadow-xl`}
      >
        <header className="flex items-center justify-between border-b border-secondary-200 px-5 py-3">
          <h2 id={titleId} className="text-lg font-semibold text-secondary-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-secondary-400 hover:text-secondary-900"
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

/** "In storage" or "In use", as a small label. */
export function StatusBadge({ status }: { status: "storage" | "in_use" }) {
  return status === "in_use" ? (
    <span className="inline-block whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
      In use
    </span>
  ) : (
    <span className="inline-block whitespace-nowrap rounded-full bg-secondary-100 px-2 py-0.5 text-xs font-semibold text-secondary-700">
      In storage
    </span>
  );
}
