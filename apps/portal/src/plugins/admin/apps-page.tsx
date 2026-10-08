import { useEffect, useState } from "react";
import { type LibraryApp, type LogEntry, platform } from "../../lib/platform";

// The app library (roadmap 4.4): which apps the team has on. Switching one off hides it from
// everyone at once (within a minute) and keeps its data for 90 days; switching it on again in that
// time brings it all back. After that the app deletes the team's data.

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
};

export function AppsPage() {
  const [apps, setApps] = useState<LibraryApp[] | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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

  async function change(app: LibraryApp, enabled: boolean) {
    if (!enabled) {
      const kept = app.keepsDataWhenOff
        ? "Its data is kept."
        : "Its data is kept for 90 days, then deleted. Switching it on again before then brings it all back.";
      if (!confirm(`Switch off ${app.name}? Nobody on the team will be able to open it. ${kept}`)) {
        return;
      }
    }
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
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={app.enabled}
              aria-label={`${app.name} ${app.enabled ? "on" : "off"}`}
              disabled={busy !== null}
              onClick={() => change(app, !app.enabled)}
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
                  {entry.appName} {ACTIONS[entry.action]}
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
