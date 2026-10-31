import { Card, ErrorBanner, Loading, Page } from "@g3/ui";
import { useEffect, useState } from "react";
import { type LogEntry, platform } from "../../lib/platform";

// The team's log (the platform's team_audit_log): apps switched on and off, data downloads, and
// big settings changes in any app (field labels only, never values).

const day = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const ACTIONS: Record<LogEntry["action"], string> = {
  app_enabled: "switched on",
  app_disabled: "switched off",
  app_data_deleted: "data deleted",
  app_exported: "data downloaded",
  settings_changed: "settings changed",
};

/** One line of the log: what happened, and for a settings change, what and which parts. */
function describe(entry: LogEntry): string {
  if (entry.action !== "settings_changed") return `${entry.appName} ${ACTIONS[entry.action]}`;
  const what = typeof entry.details.what === "string" ? entry.details.what : "Settings";
  const changed = Array.isArray(entry.details.changed) ? entry.details.changed.map(String) : [];
  return changed.length > 0 ? `${what}: ${changed.join(", ")}` : what;
}

export function LogPage() {
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    platform<LogEntry[]>("/team/log")
      .then(setLog)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <Page
      title="Log"
      description="Apps switched on and off, data downloads and settings changes, with who made them."
      width="narrow"
    >
      {error && <ErrorBanner message={error} />}
      {log === null && !error && <Loading />}
      {log?.length === 0 && <p className="text-sm text-secondary-500">Nothing has changed yet.</p>}
      {log && log.length > 0 && (
        <Card>
          <ul className="divide-y divide-secondary-100 text-sm">
            {log.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-4 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0 text-secondary-900">
                  {describe(entry)}
                  {entry.userName && (
                    <span className="text-secondary-500"> by {entry.userName}</span>
                  )}
                </span>
                <span className="shrink-0 text-secondary-500">{day(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}
