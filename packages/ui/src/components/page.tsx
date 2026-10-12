import type { ReactNode } from "react";

/** How far a page's content runs: a form, the reading column, a table or tree, or the screen. */
export type PageWidth = "narrow" | "default" | "wide" | "full";

const WIDTHS: Record<PageWidth, string> = {
  narrow: "max-w-2xl mx-auto",
  default: "max-w-5xl mx-auto",
  wide: "max-w-7xl mx-auto",
  full: "",
};

/** The whole screen while an app finds out who is signed in. */
export function PageLoading() {
  return (
    <main className="min-h-screen bg-page flex items-center justify-center">
      <p className="text-secondary-400">Loading…</p>
    </main>
  );
}

/**
 * A page under the top bar: its title, its buttons at the right, then its content. It fills the
 * room the bar leaves, so the app's shell is a column as tall as the screen
 * (`flex min-h-screen flex-col`).
 */
export function Page({
  title,
  description,
  actions,
  width = "default",
  children,
}: {
  /** The page's name: the same words as its link in the top bar. */
  title: string;
  /** A sentence under the title on what the page is for. */
  description?: ReactNode;
  actions?: ReactNode;
  /** "wide" for a page that is mostly a table or tree; "full" only for a sheet-like table. */
  width?: PageWidth;
  children: ReactNode;
}) {
  return (
    <main className="flex-1 bg-page">
      <div className={`${WIDTHS[width]} px-4 sm:px-6 py-6 space-y-5`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl text-secondary-900">{title}</h1>
            {description && <p className="mt-1 text-sm text-secondary-500">{description}</p>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </main>
  );
}
