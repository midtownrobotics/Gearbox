import type { ReactNode } from "react";

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
    <section className={`bg-surface border border-secondary-200 rounded-xl p-5 ${className}`}>
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
  "w-full rounded-lg border border-secondary-300 bg-surface px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:border-primary-500";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  const styles = {
    primary: "bg-primary-500 text-white hover:bg-primary-600",
    secondary: "bg-surface text-secondary-800 border border-secondary-300 hover:bg-secondary-50",
    danger: "bg-surface text-primary-700 border border-primary-300 hover:bg-primary-50",
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

/** A thin bar filled to `percent`. Decoration: show the number beside it. */
export function ProgressBar({ percent, className = "" }: { percent: number; className?: string }) {
  return (
    <div
      className={`h-1.5 rounded-full bg-secondary-200 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <div className="h-full rounded-full bg-primary-500" style={{ width: `${percent}%` }} />
    </div>
  );
}
