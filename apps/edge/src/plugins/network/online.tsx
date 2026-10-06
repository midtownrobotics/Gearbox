import { formatAgo } from "../../shared/format";

/** Green when the box sees the device on the LAN right now; nothing when it couldn't check. */
export function OnlineDot({ online }: { online: boolean | null }) {
  if (online === null) return null;
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${online ? "bg-emerald-500" : "bg-secondary-300"}`}
      title={online ? "Online now" : "Not on the network right now"}
      aria-label={online ? "Online now" : "Offline"}
      role="img"
    />
  );
}

/** Says when the box last checked, or why it couldn't. */
export function PresenceNote({
  presence,
}: {
  presence: { available: boolean; checkedAt: number | null; error: string | null };
}) {
  if (!presence.available) {
    return (
      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
        Couldn't check who's online: {presence.error}
      </p>
    );
  }
  return (
    <p className="text-xs text-secondary-400">
      Online status checked live on the edge box{" "}
      {presence.checkedAt ? formatAgo(presence.checkedAt) : ""}. It includes devices that only talk
      on the shop network, like printers.
    </p>
  );
}
