import type { ReactNode } from "react";

/** A panel on the page, with a small heading when it has a title. */
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

/** One figure with its label, and a line under it when there's more to say. */
export function Stat({
  label,
  value,
  hint,
}: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-secondary-400">{label}</p>
      <p className="text-2xl font-semibold text-secondary-900 mt-1">{value}</p>
      {hint && <p className="text-xs text-secondary-500 mt-0.5">{hint}</p>}
    </div>
  );
}
