import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  ConfirmQuestion,
  ErrorBanner,
  buttonClass,
  tones,
} from "@g3/ui";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { advantageScopePage } from "../../shared/getters/advantagescope";
import {
  type MatchLog,
  type MatchLogs as MatchLogsData,
  type WhenFull,
  deleteMatchLog,
  deleteMatchLogs,
  fetchMatchLogs,
  matchLogFileUrl,
  matchLogsZipUrl,
  setWhenFull,
} from "../../shared/getters/downloaders";
import { canSaveLogs, saveAdvantageScope, saveLog, useSavedLogs } from "../../shared/saved-logs";

// The match logs the team's downloaders uploaded, by event (the one uploaded to last first), each
// event's matches latest first. Anyone signed in downloads them, one or all in a zip; mentors and
// admins choose what happens once Pit has its limit, and admins delete them (one, or all after an
// export). Logs can be saved on the device ahead, so AdvantageScope opens them without
// downloading (at an event, on cellular).

const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const TYPE_ORDER = { e: 0, q: 1, p: 2 } as const;

export const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function byEvent(logs: MatchLog[]) {
  const events = new Map<string, MatchLog[]>();
  for (const log of logs) {
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

const WHEN_FULL: { value: WhenFull; label: string }[] = [
  { value: "skip-new", label: "Don't save new ones" },
  { value: "delete-oldest", label: "Delete the oldest" },
];

/** How many logs Pit has of its limit, what happens when it's full, and export. */
function Storage({
  data,
  onChange,
  onError,
}: { data: MatchLogsData; onChange: () => void; onError: (message: string) => void }) {
  // The logs in the export just started, to delete once the download has finished.
  const [exported, setExported] = useState<number[] | null>(null);
  const full = data.logs.length >= data.limit;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p className="font-semibold text-secondary-900">
            {data.logs.length} of {data.limit} logs
          </p>
          <p className="text-secondary-500">
            {full
              ? data.whenFull === "skip-new"
                ? "Pit is full: new logs stay on the downloader until you delete some here."
                : "Pit is full: each new log replaces the oldest."
              : `Pit keeps up to ${data.limit} logs.`}
          </p>
        </div>
        {data.logs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <a className={buttonClass("secondary", "sm")} href={matchLogsZipUrl()}>
              Download all
            </a>
            {data.canDelete && !exported && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setExported(data.logs.map((log) => log.id));
                  window.location.href = matchLogsZipUrl();
                }}
              >
                Export and delete all
              </Button>
            )}
          </div>
        )}
      </div>

      {exported && (
        <div className="mt-4">
          <ConfirmQuestion
            question={`Once the download has finished, delete these ${exported.length} logs from Pit? It can't be undone.`}
            confirmLabel="Delete them"
            keepLabel="Keep them"
            size="sm"
            onConfirm={async () => {
              try {
                await deleteMatchLogs(exported);
                setExported(null);
                onChange();
              } catch {
                onError("Couldn't delete the logs. Check your connection and try again.");
              }
            }}
            onKeep={() => setExported(null)}
          />
        </div>
      )}

      {data.canManage && (
        <fieldset className="mt-4 border-t border-secondary-200 pt-4">
          <legend className="sr-only">When Pit has {data.limit} logs</legend>
          <p className="mb-2 text-sm text-secondary-600">When Pit has {data.limit} logs:</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {WHEN_FULL.map((choice) => (
              <label key={choice.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="when-full"
                  checked={data.whenFull === choice.value}
                  onChange={async () => {
                    try {
                      await setWhenFull(choice.value);
                      onChange();
                    } catch {
                      onError("Couldn't save that. Check your connection and try again.");
                    }
                  }}
                />
                {choice.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </Card>
  );
}

/**
 * How many logs are on this device, and saving AdvantageScope (its own files and the team's fields
 * and robots) and the rest of the logs, so they open without a connection.
 */
function OnThisDevice({
  logs,
  saved,
  onError,
}: { logs: MatchLog[]; saved: Set<number>; onError: (message: string) => void }) {
  const [saving, setSaving] = useState<string | null>(null);
  const missing = logs.filter((log) => !saved.has(log.id));
  const bytes = missing.reduce((sum, log) => sum + log.size, 0);

  const saveAll = async () => {
    try {
      await saveAdvantageScope((done, of) =>
        setSaving(`Saving AdvantageScope (${Math.round((done / of) * 100)}%)…`),
      );
    } catch {
      setSaving(null);
      onError("Couldn't save AdvantageScope. Check your connection and try again.");
      return;
    }
    let failed = false;
    for (const [done, log] of missing.entries()) {
      setSaving(`Saving log ${done + 1} of ${missing.length}…`);
      try {
        await saveLog(log);
      } catch {
        failed = true;
      }
    }
    setSaving(null);
    if (failed) onError("Couldn't save every log. Check your connection and try again.");
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p className="font-semibold text-secondary-900">
            {saved.size} of {logs.length} logs on this device
          </p>
          <p className="text-secondary-500">
            Save AdvantageScope, your team's fields and robots, and the logs to open them without a
            connection.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={Boolean(saving)}
          onClick={() => void saveAll()}
        >
          {saving ??
            (missing.length > 0
              ? `Save all to this device (logs: ${size(bytes)})`
              : "Save AdvantageScope to this device")}
        </Button>
      </div>
    </Card>
  );
}

export function MatchLogs() {
  const [data, setData] = useState<MatchLogsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useSavedLogs(data?.logs ?? null);

  const load = useCallback(
    () =>
      fetchMatchLogs()
        .then((next) => {
          setData(next);
          setError(null);
        })
        .catch(() =>
          setError("Couldn't load the match logs. Check your connection and try again."),
        ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return error ? <ErrorBanner message={error} /> : null;
  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} />}
      <Storage data={data} onChange={() => void load()} onError={setError} />
      {canSaveLogs() && <OnThisDevice logs={data.logs} saved={saved} onError={setError} />}
      {data.logs.length === 0 ? (
        <Card>
          <p className="text-sm text-secondary-500">
            No match logs yet. They appear here once a log downloader copies them off the robot and
            is online.
          </p>
        </Card>
      ) : (
        byEvent(data.logs).map(([event, logs]) => (
          <Card key={event} title={event}>
            <ul className="divide-y divide-secondary-200">
              {logs.map((log) => (
                <li key={log.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-semibold text-secondary-900">
                      {log.name}
                      {log.trimmed && <Badge>Trimmed</Badge>}
                      {saved.has(log.id) && <Badge colors={tones.success}>On this device</Badge>}
                    </p>
                    <p className="text-xs text-secondary-500">
                      {size(log.rawSize ?? log.size)} · from {log.downloaderName}
                      {log.uploadedAt ? ` · ${whenFormat.format(log.uploadedAt)}` : ""}
                    </p>
                  </div>
                  <Link className={buttonClass("secondary", "sm")} to={advantageScopePage(log)}>
                    Open in AdvantageScope
                  </Link>
                  <a className={buttonClass("secondary", "sm")} href={matchLogFileUrl(log.id)}>
                    Download
                  </a>
                  {data.canDelete && (
                    <ConfirmButton
                      label="Delete"
                      size="sm"
                      question={`Delete ${log.name}? It can't be undone.`}
                      onConfirm={async () => {
                        try {
                          await deleteMatchLog(log.id);
                          await load();
                        } catch {
                          setError("Couldn't delete it. Check your connection and try again.");
                        }
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
