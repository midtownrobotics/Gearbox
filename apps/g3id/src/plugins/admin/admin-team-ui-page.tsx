import { type TeamUiColors, type TeamUiSettings, defaultTeamUiSettings } from "@g3/site-config";
import { refreshTeamUiSettings } from "@g3/ui";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

const colorLabels: Record<keyof TeamUiColors, string> = {
  page: "Page background",
  surface: "Cards and navigation",
  inset: "Inset backgrounds",
  line: "Borders",
  text: "Main text",
  muted: "Muted text",
  accent: "Accent",
};

const fieldClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500";

export function AdminTeamUiPage() {
  const [settings, setSettings] = useState<TeamUiSettings>(defaultTeamUiSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.admin.team.ui
      .$get()
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load team settings.");
        const data = await response.json();
        setSettings(data.settings);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Could not load team settings."),
      )
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof TeamUiSettings>(key: K, value: TeamUiSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage("");
  }

  function updateColor(mode: "light" | "dark", key: keyof TeamUiColors, value: string) {
    update(mode, { ...settings[mode], [key]: value });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await api.admin.team.ui.$put({ json: settings });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Could not save team settings.");
      }
      await refreshTeamUiSettings(true);
      setMessage("Team appearance saved. Other open tabs will pick it up when focused.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save team settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return <main className="mx-auto w-full max-w-4xl px-6 py-8">Loading team settings…</main>;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-3xl font-bold text-secondary-900">Team appearance</h1>
      <p className="mb-8 text-secondary-600">
        These settings apply to this team across Gearbox. Team number, domain, and sign-in
        configuration stay with deployment settings.
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-primary-500 p-3 text-primary-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mb-4 rounded-md border border-line p-3 text-secondary-900">
          {message}
        </p>
      )}
      <form onSubmit={save} className="space-y-8">
        <section className="rounded-lg border border-line bg-surface p-5">
          <h2 className="mb-4 text-xl font-semibold">Identity</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Team name"
              value={settings.name}
              onChange={(v) => update("name", v)}
              required
              maxLength={100}
            />
            <TextField
              label="Short name"
              value={settings.shortName}
              onChange={(v) => update("shortName", v)}
              required
              maxLength={24}
            />
            <TextField
              label="Logo URL (HTTPS)"
              value={settings.logoUrl}
              onChange={(v) => update("logoUrl", v)}
              type="url"
              placeholder="https://…"
            />
            <label className="block text-sm font-medium">
              Display font
              <select
                className={fieldClass}
                value={settings.displayFont}
                onChange={(e) =>
                  update("displayFont", e.target.value as TeamUiSettings["displayFont"])
                }
              >
                <option>Agency FB</option>
                <option>Ubuntu</option>
                <option>system-ui</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Default theme (members can override it)
              <select
                className={fieldClass}
                value={settings.defaultTheme}
                onChange={(e) =>
                  update("defaultTheme", e.target.value as TeamUiSettings["defaultTheme"])
                }
              >
                <option value="system">Use device setting</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <ColorField
              label="Primary brand color"
              value={settings.primaryColor}
              onChange={(v) => update("primaryColor", v)}
            />
          </div>
          {settings.logoUrl && (
            <img
              src={settings.logoUrl}
              alt="Team logo preview"
              className="mt-4 h-16 max-w-40 object-contain"
            />
          )}
        </section>

        <section className="rounded-lg border border-line bg-surface p-5">
          <h2 className="mb-4 text-xl font-semibold">Links</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["publicSite", "slack", "github", "instagram"] as const).map((key) => (
              <TextField
                key={key}
                label={
                  {
                    publicSite: "Public site",
                    slack: "Slack",
                    github: "GitHub",
                    instagram: "Instagram",
                  }[key]
                }
                value={settings.links[key]}
                onChange={(value) => update("links", { ...settings.links, [key]: value })}
                type="url"
                placeholder="https://…"
              />
            ))}
          </div>
        </section>

        {(["light", "dark"] as const).map((mode) => (
          <section key={mode} className="rounded-lg border border-line bg-surface p-5">
            <h2 className="mb-4 text-xl font-semibold">
              {mode === "light" ? "Light" : "Dark"} palette
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {(Object.keys(colorLabels) as (keyof TeamUiColors)[]).map((key) => (
                <ColorField
                  key={key}
                  label={colorLabels[key]}
                  value={settings[mode][key]}
                  onChange={(value) => updateColor(mode, key, value)}
                />
              ))}
            </div>
          </section>
        ))}

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save team appearance"}
        </button>
      </form>
    </main>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        className={fieldClass}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <span className="flex gap-2">
        <input
          aria-label={`${label} picker`}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-12 cursor-pointer"
        />
        <input
          className={fieldClass}
          value={value}
          pattern="#[0-9a-fA-F]{6}"
          onChange={(event) => onChange(event.target.value)}
          required
        />
      </span>
    </label>
  );
}
