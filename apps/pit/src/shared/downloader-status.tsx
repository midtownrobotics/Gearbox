import type { LogDownloader } from "./getters/downloaders";

// What the team's log downloader is doing, as it last told Pit: on Pit's Logs page and in the
// Monitor's Logs section. With several, the one online that spoke last (else the last heard from).

/** The downloader to show: online first, then the one heard from last. */
export function currentDownloader(downloaders: LogDownloader[]): LogDownloader | null {
  const heard = (d: LogDownloader) => d.statusAt ?? d.lastSeenAt ?? 0;
  return (
    [...downloaders].sort(
      (a, b) => Number(b.online) - Number(a.online) || heard(b) - heard(a),
    )[0] ?? null
  );
}

const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function ago(time: number | null) {
  if (!time) return "never";
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return whenFormat.format(time);
}

type Light = "ok" | "busy" | "off";
const LIGHTS: Record<Light, string> = {
  ok: "bg-green-500",
  busy: "bg-amber-500",
  off: "bg-secondary-300",
};

function Row({ light, label, value }: { light: Light; label: string; value: string }) {
  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className={`size-2.5 shrink-0 rounded-full ${LIGHTS[light]}`} aria-hidden />
      <span className="w-20 shrink-0 text-sm text-secondary-500">{label}</span>
      <span className="text-sm font-semibold text-secondary-900">{value}</span>
    </li>
  );
}

/** Online, the robot, copying and uploading, for one downloader. */
export function DownloaderStatusRows({ downloader }: { downloader: LogDownloader }) {
  const status = downloader.online ? downloader.status : null;
  if (!status) {
    return (
      <ul>
        <Row
          light="off"
          label="Downloader"
          value={`${downloader.name} is offline · last heard from ${ago(downloader.statusAt ?? downloader.lastSeenAt)}`}
        />
      </ul>
    );
  }
  return (
    <ul>
      <Row light="ok" label="Downloader" value={`${downloader.name} is online`} />
      <Row
        light={!status.robot ? "off" : status.rioReachable === false ? "busy" : "ok"}
        label="Robot"
        value={
          !status.robot
            ? "Not connected"
            : status.rioReachable === false
              ? "Connected, but the roboRIO isn't answering"
              : "Connected"
        }
      />
      <Row
        light={status.copying ? "busy" : "off"}
        label="Copying"
        value={
          status.copying
            ? `${status.copying} ${status.copying === 1 ? "log" : "logs"} off the robot`
            : "Idle"
        }
      />
      <Row
        light={status.uploading || status.pendingUpload ? "busy" : "ok"}
        label="Uploading"
        value={
          status.uploading
            ? `${status.uploading}${status.pendingUpload > 1 ? `, ${status.pendingUpload - 1} more waiting` : ""}`
            : status.pendingUpload
              ? `${status.pendingUpload} waiting`
              : "Up to date"
        }
      />
    </ul>
  );
}
