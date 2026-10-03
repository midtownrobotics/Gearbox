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
  children,
}: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-page">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-end justify-between gap-4">
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

export function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="text-primary-700 text-sm bg-primary-50 border border-primary-200 rounded-lg px-4 py-2.5">
      {message}
    </p>
  );
}

export function Loading() {
  return <p className="text-secondary-400 text-sm">Loading…</p>;
}
