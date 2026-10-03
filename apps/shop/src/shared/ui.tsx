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
