/** Something went wrong, or isn't allowed. Red whatever the team's color: it means a problem. */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="text-red-800 text-sm bg-red-50 border border-red-300 rounded-lg px-4 py-2.5">
      {message}
    </p>
  );
}

/** It worked: a save, an import, a change that has no other sign on the page. */
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

/** Part of a page that is still loading. */
export function Loading() {
  return <p className="text-secondary-400 text-sm">Loading…</p>;
}
