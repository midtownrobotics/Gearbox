import {
  Button,
  Card,
  ConfirmQuestion,
  ErrorBanner,
  Loading,
  Page,
  SuccessBanner,
  Switch,
} from "@g3/ui";
import { useEffect, useState } from "react";
import { type LibraryApp, type LogEntry, downloadAppData, platform } from "../../lib/platform";

// The app library (roadmap 4.4): which apps the team has on. Switching one off hides it from
// everyone at once (within a minute) and keeps its data for 90 days; switching it on again in that
// time brings it all back. After that the app deletes the team's data. Before switching one off
// its data is offered as a download, and every admin hears about the change on Slack.

const day = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

function stateOf(app: LibraryApp): string {
  if (app.enabled) {
    if (!app.changedAt) return "On";
    return `On since ${day(app.changedAt)}${app.changedBy ? `, by ${app.changedBy}` : ""}`;
  }
  if (app.dataDeleted) return "Off. Its data has been deleted.";
  if (app.deleteAfter) return `Off. Its data is kept until ${day(app.deleteAfter)}.`;
  if (app.changedAt && app.keepsDataWhenOff) return "Off. Its data is kept.";
  return "Off";
}

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

export function AppsPage() {
  const [apps, setApps] = useState<LibraryApp[] | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  /** The app being switched off: asked about (and offered its data) under its row first. */
  const [leaving, setLeaving] = useState<string | null>(null);

  async function loadLog() {
    setLog(await platform<LogEntry[]>("/team/log"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once
  useEffect(() => {
    platform<LibraryApp[]>("/team/library")
      .then(setApps)
      .catch((reason: Error) => setError(reason.message));
    loadLog().catch(() => {});
  }, []);

  async function download(app: LibraryApp) {
    setBusy(`download:${app.slug}`);
    setError("");
    try {
      await downloadAppData(app.slug);
      setMessage(`${app.name}'s data was downloaded.`);
      await loadLog();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't download its data.");
    } finally {
      setBusy(null);
    }
  }

  async function change(app: LibraryApp, enabled: boolean) {
    setLeaving(null);
    setBusy(app.slug);
    setError("");
    setMessage("");
    try {
      const result = await platform<{ apps: LibraryApp[]; seeded: boolean }>(
        `/team/library/${app.slug}`,
        { method: "PUT", body: { enabled } },
      );
      setApps(result.apps);
      setMessage(
        enabled
          ? `${app.name} is on. It may take a minute to open for everyone.${result.seeded ? "" : " Its starter content wasn't added yet; it will be when it's first opened."}`
          : `${app.name} is off.`,
      );
      await loadLog();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't change it.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page
      title="Manage Apps"
      description="Choose the apps your team uses. Sign-in and this home page are always on."
      width="narrow"
    >
      {error && <ErrorBanner message={error} />}
      {message && <SuccessBanner message={message} />}
      {apps === null && !error && <Loading />}
      <ul className="space-y-3">
        {apps?.map((app) => (
          <li key={app.slug}>
            <Card className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-secondary-900">{app.name}</h2>
                <p className="text-sm text-secondary-600">{app.summary}</p>
                {app.integrations.length > 0 && (
                  <p className="mt-1 text-xs text-secondary-500">
                    Works with: {app.integrations.join(", ")}
                  </p>
                )}
                <p className="mt-2 text-xs text-secondary-500">{stateOf(app)}</p>
                {app.exportable && leaving !== app.slug && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => download(app)}
                    className="mt-2 text-xs font-semibold text-primary-700 underline disabled:opacity-50"
                  >
                    {busy === `download:${app.slug}` ? "Downloading…" : "Download data"}
                  </button>
                )}
              </div>
              <Switch
                checked={app.enabled}
                label={`${app.name} ${app.enabled ? "on" : "off"}`}
                disabled={busy !== null}
                onChange={() =>
                  app.enabled
                    ? setLeaving(leaving === app.slug ? null : app.slug)
                    : change(app, true)
                }
                className="mt-1"
              />
              {leaving === app.slug && (
                <ConfirmQuestion
                  size="sm"
                  question={`Switch off ${app.name}? Nobody on the team can open it. ${
                    app.keepsDataWhenOff
                      ? "Its data is kept."
                      : "Its data is kept for 90 days, then deleted. Switching it on again before then brings it all back."
                  }`}
                  confirmLabel="Switch off"
                  keepLabel="Keep it on"
                  disabled={busy !== null}
                  onConfirm={() => change(app, false)}
                  onKeep={() => setLeaving(null)}
                >
                  {app.exportable && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => download(app)}
                    >
                      {busy === `download:${app.slug}` ? "Downloading…" : "Download its data first"}
                    </Button>
                  )}
                </ConfirmQuestion>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {log.length > 0 && (
        <Card title="Changes">
          <ul className="divide-y divide-secondary-100 text-sm">
            {log.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-4 py-2 first:pt-0 last:pb-0">
                <span className="text-secondary-900">
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
