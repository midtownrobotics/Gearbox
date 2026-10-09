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
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-3xl font-bold text-secondary-900">Apps</h1>
      <p className="mb-6 text-secondary-600">
        Choose the apps your team uses. Sign-in and this home page are always on.
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-500 p-3 text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mb-4 rounded-md border border-line p-3 text-secondary-900">
          {message}
        </p>
      )}
      {apps === null && !error && <p className="text-secondary-600">Loading…</p>}
      <ul className="space-y-3">
        {apps?.map((app) => (
          <li
            key={app.slug}
            className="flex items-start justify-between gap-4 rounded-lg border border-line bg-surface p-4"
          >
            <div className="min-w-0">
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
              {leaving === app.slug && (
                <div className="mt-3 space-y-3 rounded-md border border-line bg-inset p-3 text-sm">
                  <p className="text-secondary-900">
                    Switch off {app.name}? Nobody on the team can open it.{" "}
                    {app.keepsDataWhenOff
                      ? "Its data is kept."
                      : "Its data is kept for 90 days, then deleted. Switching it on again before then brings it all back."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {app.exportable && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => download(app)}
                        className="rounded-md border border-line bg-surface px-3 py-1.5 font-semibold text-secondary-900 disabled:opacity-50"
                      >
                        {busy === `download:${app.slug}`
                          ? "Downloading…"
                          : "Download its data first"}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => change(app, false)}
                      className="rounded-md bg-red-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                    >
                      Switch off
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setLeaving(null)}
                      className="px-3 py-1.5 text-secondary-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={app.enabled}
              aria-label={`${app.name} ${app.enabled ? "on" : "off"}`}
              disabled={busy !== null}
              onClick={() =>
                app.enabled ? setLeaving(leaving === app.slug ? null : app.slug) : change(app, true)
              }
              className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                app.enabled ? "bg-primary-600" : "bg-secondary-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform ${
                  app.enabled ? "translate-x-5" : ""
                }`}
              />
            </button>
          </li>
        ))}
      </ul>

      {log.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-xl font-semibold text-secondary-900">Changes</h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {log.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-4 px-4 py-2 text-sm">
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
        </section>
      )}
    </main>
  );
}
