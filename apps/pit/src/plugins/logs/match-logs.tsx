import { Card, ConfirmButton, ErrorBanner, buttonClass } from "@g3/ui";
import { useCallback, useEffect, useState } from "react";
import {
  type MatchLog,
  deleteMatchLog,
  fetchMatchLogs,
  matchLogFileUrl,
} from "../../shared/getters/downloaders";

// The match logs the team's downloaders uploaded, by event (the one uploaded to last first), each
// event's matches latest first. Anyone signed in downloads them; mentors and admins delete them.

const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const TYPE_ORDER = { e: 0, q: 1, p: 2 } as const;

const size = (bytes: number) =>
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

export function MatchLogs() {
  const [data, setData] = useState<{ logs: MatchLog[]; canDelete: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;
  if (data.logs.length === 0) {
    return (
      <Card>
        <p className="text-sm text-secondary-500">
          No match logs yet. They appear here once a log downloader copies them off the robot and is
          online.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      {byEvent(data.logs).map(([event, logs]) => (
        <Card key={event} title={event}>
          <ul className="divide-y divide-secondary-200">
            {logs.map((log) => (
              <li key={log.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-secondary-900">{log.name}</p>
                  <p className="text-xs text-secondary-500">
                    {size(log.size)} · from {log.downloaderName}
                    {log.uploadedAt ? ` · ${whenFormat.format(log.uploadedAt)}` : ""}
                  </p>
                </div>
                <a className={buttonClass("secondary", "sm")} href={matchLogFileUrl(log.id)}>
                  Download
                </a>
                {data.canDelete && (
                  <ConfirmButton
                    label="Delete"
                    size="sm"
                    question={`Delete ${log.name}? It can't be undone, though a downloader that still has it uploads it again.`}
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
      ))}
    </div>
  );
}
