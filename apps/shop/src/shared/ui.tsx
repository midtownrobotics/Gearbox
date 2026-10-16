import { useState } from "react";

export function PageLoading() {
  return (
    <main className="min-h-screen bg-page flex items-center justify-center">
      <p className="text-steel">Loading…</p>
    </main>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="text-crimson-dark text-sm bg-crimson-tint border border-crimson/30 rounded-lg px-4 py-2.5">
      {message}
    </p>
  );
}

/** An "i" that explains a setting, on hover or on a tap. */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex group shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="w-4 h-4 rounded-full border border-steel/50 text-steel-dark text-[10px] font-bold leading-none flex items-center justify-center hover:border-crimson hover:text-crimson transition-colors"
      >
        i
      </button>
      <span
        role="tooltip"
        className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-ink text-paper text-xs font-normal normal-case tracking-normal text-left rounded-md px-3 py-2 shadow-lg z-20 ${
          open ? "block" : "hidden group-hover:block"
        }`}
      >
        {children}
      </span>
    </span>
  );
}
