import { useIsOnline } from "@g3/ui";

export function OfflineBanner() {
  const isOnline = useIsOnline();

  if (isOnline) return;

  return (
    <p
      role="status"
      className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800"
    >
      You are in offline mode.
    </p>
  );
}
