import { Badge, Button, Card, Stat, buttonClass, tones } from "@g3/ui";
import { type ReactNode, useState } from "react";
import type { LogStatus, Status } from "../../src/status.ts";

const size = (bytes: number | null) =>
  bytes == null
    ? "—"
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const ago = (time: number) => {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
};

/** A status light: its color is its meaning, the same for every team. */
type Light = "ok" | "busy" | "problem" | "off";
const LIGHTS: Record<Light, string> = {
  ok: "bg-emerald-500",
  busy: "bg-amber-500",
  problem: "bg-red-500",
  off: "bg-secondary-300",
};

function Tile({
  label,
  light,
  value,
  hint,
}: { label: string; light: Light; value: string; hint: string }) {
  return (
    <Card className="flex gap-3">
      <span className={`mt-1 size-2.5 shrink-0 rounded-full ${LIGHTS[light]}`} aria-hidden />
      <div className="min-w-0 break-words">
        <Stat label={label} value={value} hint={hint} />
      </div>
    </Card>
  );
}

export function ConnectionTiles({ status }: { status: Status }) {
  const { connection: c, settings, counts } = status;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Tile
        label="Robot"
        light={c.robot ? "ok" : "off"}
        value={c.robot ? "Connected" : "Not connected"}
        hint={
          c.robot
            ? `roboRIO at ${settings.rioIp}`
            : `Join the robot's network (${settings.robotNetwork}.x) to copy its logs`
        }
      />
      <Tile
        label="Copying"
        light={c.downloadingIds.length ? "busy" : "off"}
        value={c.downloadingIds.length ? `${c.downloadingIds.length} in progress` : "Idle"}
        hint={
          c.downloadingIds.length
            ? c.downloadingIds.join(", ")
            : c.rioLogsCheckedAt
              ? `Robot checked ${ago(c.rioLogsCheckedAt)}`
              : "The robot hasn't been checked yet"
        }
      />
      <Tile
        label="Internet"
        light={c.internet ? "ok" : counts.pendingUpload ? "busy" : "off"}
        value={c.internet ? "Online" : "Offline"}
        hint={
          c.internet ? "Logs can upload to Gearbox" : "Uploads wait until this computer is online"
        }
      />
      <Tile
        label="Gearbox"
        light={c.uploadingRunning || counts.pendingUpload ? "busy" : "ok"}
        value={
          c.uploadingRunning
            ? "Uploading"
            : counts.pendingUpload
              ? `${counts.pendingUpload} waiting`
              : "Up to date"
        }
        hint={
          c.uploadingId
            ? `Now: ${c.uploadingId}`
            : counts.pendingUpload
              ? "Uploaded once this computer is online"
              : "Every copied log is in Pit"
        }
      />
    </div>
  );
}

export function Counts({ status }: { status: Status }) {
  const { counts } = status;
  return (
    <Card>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="On the robot" value={counts.onRobot} />
        <Stat label="Copied here" value={counts.downloaded} />
        <Stat label="In Gearbox" value={counts.uploaded} />
        <Stat label="Waiting to upload" value={counts.pendingUpload} />
      </div>
    </Card>
  );
}

const TYPE_ORDER = { Elimination: 0, Qualification: 1, Practice: 2 } as const;

/** Events with the newest first (the one copied last), each with its matches, latest first. */
function byEvent(logs: LogStatus[]) {
  const events = new Map<string, LogStatus[]>();
  for (const log of [...logs].reverse()) {
    const list = events.get(log.event) ?? [];
    list.push(log);
    events.set(log.event, list);
  }
  for (const list of events.values()) {
    list.sort(
      (a, b) => TYPE_ORDER[a.matchType] - TYPE_ORDER[b.matchType] || b.matchNumber - a.matchNumber,
    );
  }
  return [...events];
}

function LogBadges({ log }: { log: LogStatus }) {
  const badges: ReactNode[] = [];
  if (log.onRobot) badges.push(<Badge key="robot">On robot</Badge>);
  if (log.downloading) {
    badges.push(
      <Badge key="local" colors={tones.warning}>
        Copying…
      </Badge>,
    );
  } else if (log.sizeBytes === null) {
    badges.push(
      <Badge key="local" colors={tones.danger}>
        Missing here
      </Badge>,
    );
  }
  badges.push(
    log.uploading ? (
      <Badge key="gearbox" colors={tones.warning}>
        Uploading…
      </Badge>
    ) : log.uploaded ? (
      <Badge key="gearbox" colors={tones.success}>
        In Gearbox
      </Badge>
    ) : (
      <Badge key="gearbox">Waiting to upload</Badge>
    ),
  );
  return <div className="flex flex-wrap gap-1.5">{badges}</div>;
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      title={path}
      onClick={() => {
        void navigator.clipboard.writeText(path).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? "Copied" : "Copy path"}
    </Button>
  );
}

function LogRow({ log }: { log: LogStatus }) {
  const here = log.downloaded && log.sizeBytes !== null;
  const download = `/api/download?event=${encodeURIComponent(log.event)}&file=${encodeURIComponent(log.localFile)}`;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="w-36 shrink-0">
        <p className="font-semibold text-secondary-900">{log.name}</p>
        <p className="text-xs text-secondary-500">{size(log.sizeBytes)}</p>
      </div>
      <LogBadges log={log} />
      <div className="ml-auto flex flex-wrap gap-2">
        {here && (
          <a className={buttonClass("secondary", "sm")} href={download}>
            Download
          </a>
        )}
        {here && <CopyPathButton path={log.localPath} />}
      </div>
    </li>
  );
}

export function LogsCard({ status }: { status: Status }) {
  if (!status.logs.length) {
    return (
      <Card title="Logs">
        <p className="text-sm text-secondary-500">
          No logs yet. Connect this computer to the robot's network and they'll be copied here.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      {byEvent(status.logs).map(([event, logs]) => (
        <Card key={event} title={event}>
          <ul className="divide-y divide-secondary-200">
            {logs.map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

export function RobotCard({ status }: { status: Status }) {
  const { rioLogs, connection } = status;
  return (
    <Card title="On the robot">
      {rioLogs.length ? (
        <ul className="divide-y divide-secondary-200">
          {rioLogs.map((r) => (
            <li key={`${r.origin}/${r.filename}`} className="flex items-center gap-3 py-2">
              <span className="w-24 shrink-0 font-semibold text-secondary-900">{r.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-secondary-500">
                {r.origin}
              </span>
              {r.downloaded ? (
                <Badge colors={tones.success}>Copied</Badge>
              ) : (
                <Badge colors={tones.warning}>Not copied yet</Badge>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-secondary-500">
          {connection.rioLogsCheckedAt
            ? "No match logs were on the robot when it was last checked."
            : "Connect to the robot to see its logs."}
        </p>
      )}
    </Card>
  );
}

export function ActivityCard({ status }: { status: Status }) {
  return (
    <Card title="Activity">
      {status.activity.length ? (
        <ul className="max-h-80 space-y-1.5 overflow-y-auto">
          {status.activity.map((a) => (
            <li key={a.id} className="flex gap-3 text-sm">
              <span className="shrink-0 font-mono text-xs leading-5 text-secondary-400">
                {a.time}
              </span>
              <span className="min-w-0 break-words text-secondary-700">{a.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-secondary-500">Nothing yet.</p>
      )}
    </Card>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-secondary-500">{label}</dt>
      <dd className="mb-2 min-w-0 break-all text-secondary-900 sm:mb-0">{children}</dd>
    </>
  );
}

export function SettingsCard({ status }: { status: Status }) {
  const { settings } = status;
  return (
    <Card title="Settings">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        <Setting label="Team">{settings.teamNumber}</Setting>
        <Setting label="roboRIO">{settings.rioIp}</Setting>
        <Setting label="Logs on this computer">
          <span className="font-mono text-xs">{settings.localLogsDir}</span>
        </Setting>
        <Setting label="Logs on the robot">
          <span className="font-mono text-xs">{settings.rioLogDirs.join(", ")}</span>
        </Setting>
      </dl>
      <p className="mt-4 text-xs text-secondary-500">
        To change them, edit config.env next to the downloader and start it again.
      </p>
    </Card>
  );
}
