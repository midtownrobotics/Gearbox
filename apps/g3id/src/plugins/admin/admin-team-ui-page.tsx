import {
  type Hsv,
  type TeamUiColors,
  type TeamUiLinkKey,
  type TeamUiSettings,
  hexToHsv,
  hsvToHex,
  isHexColor,
  pageTeamId,
  teamUiDefaults,
  teamUiLinkLabels,
} from "@g3/site-config";
import { refreshTeamUiSettings } from "@g3/ui";
import { type CSSProperties, useEffect, useState } from "react";
import { api } from "../../lib/api";

type Mode = "light" | "dark";
const modes: Mode[] = ["light", "dark"];

// A theme's colours other than its accent, which has its own controls (AccentColors).
const colorLabels: Record<Exclude<keyof TeamUiColors, "accent">, string> = {
  page: "Page background",
  surface: "Cards and navigation",
  inset: "Inset backgrounds",
  line: "Borders",
  text: "Text",
  muted: "Muted text",
};

const fieldClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500";

export function AdminTeamUiPage() {
  const [settings, setSettings] = useState<TeamUiSettings>(() => teamUiDefaults(pageTeamId));
  // The team's own defaults (its name and number), from G3ID: what "Reset to defaults" restores.
  const [defaults, setDefaults] = useState<TeamUiSettings>(() => teamUiDefaults(pageTeamId));
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
        setDefaults(data.defaults);
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

  function updateColor(mode: Mode, key: keyof TeamUiColors, value: string) {
    update(mode, { ...settings[mode], [key]: value });
  }

  function updateAccents(accents: Partial<Record<Mode, string>>) {
    setSettings((current) => {
      const next = { ...current };
      for (const mode of modes) {
        const accent = accents[mode];
        if (accent !== undefined) next[mode] = { ...current[mode], accent };
      }
      return next;
    });
    setMessage("");
  }

  // A field that can't be saved may be inside the closed "More options" panel, where the browser
  // can't point at it: open the panel so it can.
  function revealInvalid(event: React.FormEvent) {
    const panel = (event.target as HTMLElement).closest("details");
    if (panel) panel.open = true;
  }

  function reset() {
    setSettings(structuredClone(defaults));
    setError("");
    setMessage("Defaults restored in this form. Save team appearance to apply them.");
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
      <form onSubmit={save} onInvalidCapture={revealInvalid} className="space-y-8">
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
          <h2 className="mb-2 text-xl font-semibold">Colors</h2>
          <p className="mb-4 text-sm text-secondary-600">
            Your team's color, in a shade for each theme. Buttons and app icons use the light accent
            in both themes. In dark mode, links and highlights use the dark accent, so they stay
            readable on a dark background.
          </p>
          <AccentColors
            light={settings.light}
            dark={settings.dark}
            linked={settings.linkAccents}
            onLinkedChange={(linked) => update("linkAccents", linked)}
            onChange={updateAccents}
          />
          <details className="mt-5 rounded-md border border-line">
            <summary className="cursor-pointer px-4 py-3 font-semibold">More options</summary>
            <div className="space-y-6 border-t border-line p-4">
              <p className="text-sm text-secondary-600">
                The backgrounds, borders and text of each theme, used across every app. Colors that
                carry a meaning, such as green for done or red for an error, stay as they are.
              </p>
              {modes.map((mode) => (
                <div key={mode}>
                  <h3 className="mb-3 font-semibold">
                    {mode === "light" ? "Light" : "Dark"} palette
                  </h3>
                  <div className="grid gap-4 md:grid-cols-3">
                    <ThemePreview
                      mode={mode}
                      colors={settings[mode]}
                      brand={settings.light.accent}
                      shortName={settings.shortName}
                    />
                    <div className="grid content-start gap-4 sm:grid-cols-2 md:col-span-2">
                      {(Object.keys(colorLabels) as (keyof typeof colorLabels)[]).map((key) => (
                        <ColorField
                          key={key}
                          label={colorLabels[key]}
                          value={settings[mode][key]}
                          onChange={(value) => updateColor(mode, key, value)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </section>

        <section className="rounded-lg border border-line bg-surface p-5">
          <h2 className="mb-4 text-xl font-semibold">Links</h2>
          <p className="mb-4 text-sm text-secondary-600">
            Edit the links shown on the portal. Hide a link to keep its URL for later, or remove it
            to clear its URL. Empty links are omitted. Hiding the public site also hides its link on
            the portal sign-in screen.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(teamUiLinkLabels) as TeamUiLinkKey[]).map((key) => (
              <div key={key} className="space-y-2">
                <TextField
                  label={teamUiLinkLabels[key]}
                  value={settings.links[key]}
                  onChange={(value) => update("links", { ...settings.links, [key]: value })}
                  type="url"
                  placeholder="https://…"
                />
                <div className="flex items-center justify-between gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.hiddenLinks.includes(key)}
                      onChange={(event) =>
                        update(
                          "hiddenLinks",
                          event.target.checked
                            ? [...settings.hiddenLinks, key]
                            : settings.hiddenLinks.filter((link) => link !== key),
                        )
                      }
                    />
                    Hide {teamUiLinkLabels[key]}
                  </label>
                  <button
                    type="button"
                    disabled={!settings.links[key] || saving}
                    className="text-primary-700 underline disabled:opacity-50"
                    onClick={() => update("links", { ...settings.links, [key]: "" })}
                    aria-label={`Remove ${teamUiLinkLabels[key]} link`}
                  >
                    Remove link
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save team appearance"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={reset}
            className="rounded-md border border-line bg-surface px-5 py-3 font-semibold text-secondary-900 disabled:opacity-50"
          >
            Reset to defaults
          </button>
        </div>
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

/**
 * A theme's colours together, as the apps use them: a top bar and a card on the page, with text,
 * muted text, an inset box, a link in the accent and a button in the brand colour (the light
 * accent, in both themes).
 */
function ThemePreview({
  mode,
  colors,
  brand,
  shortName,
}: { mode: Mode; colors: TeamUiColors; brand: string; shortName: string }) {
  return (
    <div
      role="img"
      aria-label={`${mode === "light" ? "Light" : "Dark"} theme preview`}
      className="self-start overflow-hidden rounded-md border text-sm md:order-last"
      style={{ background: colors.page, borderColor: colors.line, color: colors.text }}
    >
      <div
        className="flex flex-wrap items-center gap-x-3 border-b px-3 py-2"
        style={{ background: colors.surface, borderColor: colors.line }}
      >
        <span className="font-bold uppercase" style={{ color: colors.accent }}>
          {shortName} App
        </span>
        <span style={{ color: colors.muted }}>Home</span>
        <span
          className="border-b-2 font-medium"
          style={{ color: colors.accent, borderColor: colors.accent }}
        >
          Parts
        </span>
      </div>
      <div className="p-3">
        <p className="font-semibold">Page title</p>
        <p style={{ color: colors.muted }}>Muted text on the page.</p>
        <div
          className="mt-3 rounded-md border p-3"
          style={{ background: colors.surface, borderColor: colors.line }}
        >
          <p className="font-semibold">Card</p>
          <p style={{ color: colors.muted }}>Muted text on a card.</p>
          <p className="mt-2 rounded px-2 py-1.5" style={{ background: colors.inset }}>
            Inset background
          </p>
          <p className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="underline" style={{ color: colors.accent }}>
              A link
            </span>
            <span
              className="rounded-md px-3 py-1.5 font-semibold text-white"
              style={{ background: `color-mix(in srgb, ${brand}, black 15%)` }}
            >
              Button
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

const otherMode = (mode: Mode): Mode => (mode === "light" ? "dark" : "light");

// The two parts of an accent its own sliders set; its hue comes from the colour entered.
const sliders: { part: "s" | "v"; label: string }[] = [
  { part: "s", label: "Saturation" },
  { part: "v", label: "Brightness" },
];

const sliderClass = [
  "mt-1 block h-3 w-full cursor-pointer appearance-none rounded-full border border-line",
  "[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5",
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
  "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-solid",
  "[&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--shade)]",
  "[&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgb(0_0_0/0.45)]",
  "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full",
  "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-solid",
  "[&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[var(--shade)]",
  "[&::-moz-range-thumb]:shadow-[0_0_0_1px_rgb(0_0_0/0.45)]",
].join(" ");

/**
 * A colour just entered, for the sliders. Black has no hue or saturation and a grey no hue, so
 * those stay as they were: the sliders can bring the colour back.
 */
function shadeOf(entered: Hsv, previous: Hsv): Hsv {
  if (entered.v === 0) return { ...previous, v: 0 };
  return entered.s === 0 ? { ...entered, h: previous.h } : entered;
}

/**
 * The team's accent in each theme. Linked, a colour entered in either box gives the other its
 * hue, and the other keeps its own saturation and brightness; unlinked, the two are chosen freely.
 * Either way the sliders under a box change only that box, and never its hue.
 */
function AccentColors({
  light,
  dark,
  linked,
  onLinkedChange,
  onChange,
}: {
  light: TeamUiColors;
  dark: TeamUiColors;
  linked: boolean;
  onLinkedChange: (linked: boolean) => void;
  onChange: (accents: Partial<Record<Mode, string>>) => void;
}) {
  const palettes = { light, dark };
  // Each accent as the sliders see it. A hex code alone forgets the hue of a colour slid down to
  // grey or black, and rounds the rest, so the exact shade is kept here beside it.
  const [kept, setKept] = useState<Record<Mode, Hsv>>(() => ({
    light: isHexColor(light.accent) ? hexToHsv(light.accent) : { h: 0, s: 0, v: 0 },
    dark: isHexColor(dark.accent) ? hexToHsv(dark.accent) : { h: 0, s: 0, v: 0 },
  }));
  // A colour that arrived from outside (loaded, or reset to defaults) replaces the kept shade.
  let shades = kept;
  for (const mode of modes) {
    const hex = palettes[mode].accent.toLowerCase();
    if (isHexColor(hex) && hsvToHex(shades[mode]) !== hex) {
      shades = { ...shades, [mode]: hexToHsv(hex) };
    }
  }
  if (shades !== kept) setKept(shades);

  function enter(mode: Mode, text: string) {
    // Still being typed: nothing else changes until it's a whole colour.
    if (!isHexColor(text)) return onChange({ [mode]: text });
    const entered = hexToHsv(text);
    const next = { ...shades, [mode]: shadeOf(entered, shades[mode]) };
    const accents: Partial<Record<Mode, string>> = { [mode]: text };
    // A grey or black has no hue to give the other accent.
    if (linked && entered.s > 0) {
      const twin = otherMode(mode);
      next[twin] = { ...shades[twin], h: entered.h };
      accents[twin] = hsvToHex(next[twin]);
    }
    setKept(next);
    onChange(accents);
  }

  function slide(mode: Mode, part: "s" | "v", percent: number) {
    const shade = { ...shades[mode], [part]: percent / 100 };
    setKept({ ...shades, [mode]: shade });
    onChange({ [mode]: hsvToHex(shade) });
  }

  return (
    <div>
      <div className="grid gap-6 sm:grid-cols-2">
        {modes.map((mode) => {
          const palette = palettes[mode];
          const shade = shades[mode];
          const label = mode === "light" ? "Light mode accent" : "Dark mode accent";
          const shown = hsvToHex(shade);
          return (
            <div key={mode}>
              <label className="block text-sm font-medium">
                {label}
                <span className="flex gap-2">
                  <input
                    aria-label={`${label} picker`}
                    type="color"
                    value={shown}
                    onChange={(event) => enter(mode, event.target.value)}
                    className="h-10 w-12 cursor-pointer"
                  />
                  <input
                    className={fieldClass}
                    value={palette.accent}
                    pattern="#[0-9a-fA-F]{6}"
                    onChange={(event) => enter(mode, event.target.value)}
                    required
                  />
                </span>
              </label>
              {sliders.map(({ part, label: name }) => {
                const percent = Math.round(shade[part] * 100);
                // The track runs through the colours the slider can reach.
                const from = hsvToHex({ ...shade, [part]: 0 });
                const to = hsvToHex({ ...shade, [part]: 1 });
                return (
                  <label key={part} className="mt-3 block text-sm font-medium">
                    <span className="flex justify-between">
                      {name}
                      <span className="font-normal text-secondary-600">{percent}%</span>
                    </span>
                    <input
                      aria-label={`${label} ${name.toLowerCase()}`}
                      type="range"
                      min={0}
                      max={100}
                      value={percent}
                      onChange={(event) => slide(mode, part, Number(event.target.value))}
                      className={sliderClass}
                      style={
                        {
                          background: `linear-gradient(to right, ${from}, ${to})`,
                          "--shade": shown,
                        } as CSSProperties
                      }
                    />
                  </label>
                );
              })}
              {/* The accent as it will sit on this theme's own backgrounds. */}
              <div
                className="mt-3 grid grid-cols-2 overflow-hidden rounded-md border text-center text-sm font-semibold"
                style={{ borderColor: palette.line, color: shown }}
              >
                <span className="px-3 py-2" style={{ background: palette.page }}>
                  On the page
                </span>
                <span className="px-3 py-2" style={{ background: palette.surface }}>
                  On cards
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <label className="mt-5 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={linked}
          onChange={(event) => onLinkedChange(event.target.checked)}
        />
        <span>
          <span className="font-medium">Link the light and dark accents</span>
          <span className="block text-secondary-600">
            A color entered in either box gives the other the same hue. Each keeps its own
            saturation and brightness, set with its sliders.
          </span>
        </span>
      </label>
    </div>
  );
}
