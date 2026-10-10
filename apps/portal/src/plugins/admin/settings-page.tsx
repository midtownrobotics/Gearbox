import { type AppName, appUrl } from "@g3/site-config";
import { useEffect, useState } from "react";
import {
  type AppSetting,
  type SettingValue,
  type SettingsApp,
  type TeamSettingsState,
  appSettings,
  platform,
} from "../../lib/platform";
import { Switch } from "./switch";

// Each app's team settings (roadmap 4.5), in a form built from its manifest (the platform's
// /team/settings) and saved through the app's own /team-settings. The apps' own pages don't
// edit these: this is the one place. Mentors and admins open it; each setting is changed only
// by whom its manifest allows. An integration's keys aren't here:
// they're on the Integrations page, and set up in the app.

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleString(undefined, { month: "long" }),
);
const GB = 1e9;

/** A setting's page in its app (`<app>:<path>` for another app's). */
export function pageUrl(slug: string, page: string) {
  const [app, path] = page.includes(":") ? page.split(":", 2) : [slug, page];
  return `${appUrl(app as AppName)}${path}`;
}

/** The settings a form shows: not an integration's connection. */
const formSettings = (app: SettingsApp) => app.settings.filter((s) => !s.integration);

const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-secondary-900 disabled:opacity-60";

function Field({
  setting,
  value,
  secretSet,
  disabled,
  onChange,
}: {
  setting: AppSetting;
  value: SettingValue;
  secretSet: boolean;
  disabled: boolean;
  onChange: (value: SettingValue) => void;
}) {
  const id = `setting-${setting.key}`;
  switch (setting.type) {
    case "boolean":
      return (
        <Switch
          on={value === true}
          label={setting.label}
          disabled={disabled}
          onChange={(on) => onChange(on)}
        />
      );
    case "choice":
      return (
        <select
          id={id}
          className={inputClass}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          {setting.choices?.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      );
    case "month":
      return (
        <select
          id={id}
          className={inputClass}
          disabled={disabled}
          value={typeof value === "number" ? value : 1}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      );
    case "day of year": {
      const [month, day] = typeof value === "string" ? value.split("-").map(Number) : [1, 1];
      const pad = (n: number) => String(n).padStart(2, "0");
      return (
        <div className="flex gap-2">
          <select
            id={id}
            aria-label={`${setting.label}: month`}
            className={inputClass}
            disabled={disabled}
            value={month}
            onChange={(e) => onChange(`${pad(Number(e.target.value))}-${pad(day)}`)}
          >
            {MONTHS.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
          <input
            type="number"
            aria-label={`${setting.label}: day`}
            min={1}
            max={31}
            className={`${inputClass} w-20`}
            disabled={disabled}
            value={day}
            onChange={(e) => onChange(`${pad(month)}-${pad(Number(e.target.value) || 1)}`)}
          />
        </div>
      );
    }
    case "number":
      return (
        <input
          id={id}
          type="number"
          min={setting.min}
          max={setting.max}
          className={inputClass}
          disabled={disabled}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    case "bytes":
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            min={0}
            step="any"
            className={inputClass}
            disabled={disabled}
            value={typeof value === "number" ? value / GB : ""}
            onChange={(e) =>
              onChange(e.target.value === "" ? null : Math.round(Number(e.target.value) * GB))
            }
          />
          <span className="text-sm text-secondary-600">GB</span>
        </div>
      );
    case "secret":
      return (
        <input
          id={id}
          type="password"
          autoComplete="off"
          placeholder={secretSet ? "Set. Enter a new one to replace it." : "Not set"}
          className={inputClass}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <input
          id={id}
          type={setting.type === "url" ? "url" : "text"}
          className={inputClass}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** One app's settings form. */
function AppSettingsCard({ app }: { app: SettingsApp }) {
  const settings = formSettings(app);
  const [state, setState] = useState<TeamSettingsState | null>(null);
  const [draft, setDraft] = useState<Record<string, SettingValue>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    appSettings(app.slug)
      .then(setState)
      .catch((reason: Error) => setError(reason.message));
  }, [app.slug]);

  const value = (s: AppSetting) =>
    s.key in draft ? draft[s.key] : s.type === "secret" ? null : (state?.values[s.key] ?? null);
  const changed = Object.keys(draft).length > 0;

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      setState(await appSettings(app.slug, draft));
      setDraft({});
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save them.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="mb-4 text-lg font-semibold text-secondary-900">{app.name}</h2>
      {!state && !error && <p className="text-sm text-secondary-600">Loading…</p>}
      {state && (
        <div className="space-y-4">
          {settings.map((s) => (
            <div
              key={s.key}
              className={s.type === "boolean" ? "flex items-start justify-between gap-4" : ""}
            >
              <div className={s.type === "boolean" ? "" : "mb-1"}>
                <label
                  htmlFor={`setting-${s.key}`}
                  className="text-sm font-medium text-secondary-900"
                >
                  {s.label}
                </label>
                {s.help && <p className="text-xs text-secondary-500">{s.help}</p>}
              </div>
              <Field
                setting={s}
                value={value(s)}
                secretSet={state.secretsSet[s.key] ?? false}
                disabled={busy || !state.canEdit.includes(s.key)}
                onChange={(v) => {
                  setSaved(false);
                  setDraft((d) => ({ ...d, [s.key]: v }));
                }}
              />
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}
      {state && (
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            disabled={busy || !changed}
            onClick={save}
            className="rounded-md bg-primary-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {changed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft({})}
              className="text-sm text-secondary-600"
            >
              Undo changes
            </button>
          )}
          {saved && !changed && <span className="text-sm text-green-700">Saved.</span>}
        </div>
      )}
    </section>
  );
}

/** An app whose settings are only on its own pages. */
function ElsewhereCard({ app }: { app: SettingsApp }) {
  const pages = [...new Set(formSettings(app).flatMap((s) => (s.page ? [s.page] : [])))];
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="mb-1 text-lg font-semibold text-secondary-900">{app.name}</h2>
      <p className="text-sm text-secondary-600">
        {formSettings(app)
          .map((s) => s.label)
          .join(", ")}
        .{" "}
        {pages.map((page) => (
          <a
            key={page}
            href={pageUrl(app.slug, page)}
            className="font-semibold text-primary-700 underline"
          >
            Change them in {app.name}
          </a>
        ))}
      </p>
    </section>
  );
}

export function SettingsPage() {
  const [apps, setApps] = useState<SettingsApp[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    platform<SettingsApp[]>("/team/settings")
      .then(setApps)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-3xl font-bold text-secondary-900">App settings</h1>
      <p className="mb-6 text-secondary-600">Settings for each app your team has on.</p>
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-500 p-3 text-red-700">
          {error}
        </p>
      )}
      {apps === null && !error && <p className="text-secondary-600">Loading…</p>}
      {apps?.length === 0 && (
        <p className="text-secondary-600">None of your team's apps have settings.</p>
      )}
      <div className="space-y-4">
        {apps?.map((app) =>
          app.settingsForm ? (
            <AppSettingsCard key={app.slug} app={app} />
          ) : (
            <ElsewhereCard key={app.slug} app={app} />
          ),
        )}
      </div>
    </main>
  );
}
