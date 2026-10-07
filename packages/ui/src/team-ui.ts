import {
  type TeamUiColors,
  type TeamUiSettings,
  apiPath,
  brandColor,
  builtInBrandColor,
  defaultTeamUiSettings,
  pageTeamId,
  pageTeamNumber,
  teamUiDefaults,
} from "@g3/site-config";
import { useEffect, useState, useSyncExternalStore } from "react";
import { applyTabIcons, iconDataUrl, isIconAccent, loadIconSvg, recolorIcon } from "./team-icon";
import { setDefaultTheme, syncThemeColor } from "./theme";

// The page's team's appearance (roadmap 2.10): its defaults until G3ID's /team/ui answers, so a team
// never sees another team's name first.
const initial = teamUiDefaults(pageTeamId);
let current: TeamUiSettings = initial;
let loadedAt = 0;
let pending: Promise<void> | null = null;
let originalTitle: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/**
 * The team's colours as the variables colors.css declares: both themes' (--g3-light-page,
 * --g3-dark-page), the showing theme's (--g3-page) and the brand colour, which is the light accent
 * in both themes.
 */
function applyColors(colors: TeamUiColors) {
  const style = document.documentElement.style;
  for (const mode of ["light", "dark"] as const) {
    for (const [key, color] of Object.entries(current[mode])) {
      style.setProperty(`--g3-${mode}-${key}`, color);
    }
  }
  for (const [key, color] of Object.entries(colors)) style.setProperty(`--g3-${key}`, color);
  style.setProperty("--g3-brand", current.light.accent);
}

// The neutral ramps apps write their greys with (text-secondary-600, border-gray-200).
const NEUTRALS = ["secondary", "gray", "slate", "zinc", "neutral", "stone"];
const NEUTRAL_KEYS = ["surface", "inset", "line", "muted", "text"] as const;
// What a light colour left at its default stands for in the built-in ramp (index.css).
const BUILT_IN_NEUTRALS: Record<(typeof NEUTRAL_KEYS)[number], string> = {
  surface: "#ffffff",
  inset: "#efefef",
  line: "#e0e0e0",
  muted: "#5a5a5a",
  text: "#1a1a1a",
};

/**
 * The greys inside every app, from the team's colours. In light mode the ramps are built in
 * (index.css, and Tailwind's own greys), and stay exactly so for a team on the default colours. A
 * team that changes its light card, inset, border, text or muted colour gets ramps built from
 * them: 100 is the inset colour, 200 the border, 500 muted text, 900 text, and the steps between
 * are mixes. Dark mode builds its ramps the same way in CSS (theme-palette.css), so nothing is set
 * here for it.
 */
function applyNeutrals(root: HTMLElement) {
  const defaults = defaultTeamUiSettings.light;
  const changed = (key: (typeof NEUTRAL_KEYS)[number]) =>
    current.light[key].toLowerCase() !== defaults[key];
  const custom = root.dataset.theme !== "dark" && NEUTRAL_KEYS.some(changed);
  const of = (key: (typeof NEUTRAL_KEYS)[number]) =>
    changed(key) ? current.light[key] : BUILT_IN_NEUTRALS[key];
  const mix = (from: string, to: string, percent: number) =>
    `color-mix(in srgb, ${from}, ${to} ${percent}%)`;
  const ramp: Record<number, string> = {
    50: mix(of("inset"), of("surface"), 50),
    100: of("inset"),
    200: of("line"),
    300: mix(of("line"), of("muted"), 24),
    400: mix(of("line"), of("muted"), 64),
    500: of("muted"),
    600: mix(of("muted"), of("text"), 33),
    700: mix(of("muted"), of("text"), 50),
    800: mix(of("muted"), of("text"), 75),
    900: of("text"),
    950: of("text"),
  };
  for (const family of NEUTRALS) {
    for (const [step, shade] of Object.entries(ramp)) {
      if (custom) root.style.setProperty(`--color-${family}-${step}`, shade);
      else root.style.removeProperty(`--color-${family}-${step}`);
    }
  }
}

function applySettings() {
  const root = document.documentElement;
  applyColors(root.dataset.theme === "dark" ? current.dark : current.light);
  applyNeutrals(root);
  syncThemeColor();
  root.style.setProperty(
    "--font-display",
    current.displayFont === "system-ui" ? "system-ui" : `"${current.displayFont}", sans-serif`,
  );
  // The primary palette, from the team's brand colour (its light accent). Tailwind utilities
  // resolve these variables at runtime across all apps. Solid fills are the same in both themes;
  // the tints behind banners and selected rows are dark in dark mode (the brand colour sunk into
  // the page), and brand text there takes the dark accent (theme.css).
  const base = brandColor(current);
  const dark = root.dataset.theme === "dark";
  const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  const blends = [90, 75, 55, 35, 18, 0, 15, 30, 45, 60];
  const darkTints = [85, 75, 52, 27];
  for (let i = 0; i < steps.length; i++) {
    if (base === builtInBrandColor) {
      root.style.removeProperty(`--color-primary-${steps[i]}`);
      continue;
    }
    const shade =
      dark && i < darkTints.length
        ? `color-mix(in srgb, ${base}, var(--g3-page) ${darkTints[i]}%)`
        : i < 5
          ? `color-mix(in srgb, ${base}, white ${blends[i]}%)`
          : i === 5
            ? base
            : `color-mix(in srgb, ${base}, black ${blends[i]}%)`;
    root.style.setProperty(`--color-primary-${steps[i]}`, shade);
  }
  // The tab's icon takes the team's colour too (team-icon.ts).
  applyTabIcons(base);
  // index.html's title is the app's own name ("Orders"; "ID" for the sign-in app); the team's
  // short name goes in front: "G3 Orders", "G3ID".
  originalTitle ??= document.title;
  document.title =
    originalTitle === "ID" ? `${current.shortName}ID` : `${current.shortName} ${originalTitle}`;
}

/** Refreshes the public settings after a save or after a minute away from this tab. */
export function refreshTeamUiSettings(force = false): Promise<void> {
  if (pending) return force ? pending.then(() => refreshTeamUiSettings(true)) : pending;
  const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  // In production, G3ID's API on the page's own address, which the gateway answers for the page's
  // team (so each team gets its own appearance).
  const endpoint =
    import.meta.env.VITE_G3ID_API_URL ?? (local ? "http://localhost:8787" : apiPath("id"));
  pending = fetch(`${endpoint}/team/ui`, { cache: force ? "no-store" : "default" })
    .then(async (response) => {
      if (!response.ok) return;
      const data = (await response.json()) as TeamUiSettings;
      current = data;
      loadedAt = Date.now();
      setDefaultTheme(current.defaultTheme);
      applySettings();
      notify();
    })
    .catch(() => {
      // The last known/default appearance remains usable while identity is unreachable.
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTeamUiSettings(): TeamUiSettings {
  const settings = useSyncExternalStore(
    subscribe,
    () => current,
    () => initial,
  );
  useEffect(() => {
    const refresh = () => {
      if (Date.now() - loadedAt > 60_000) void refreshTeamUiSettings();
      else applySettings();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("g3-theme-changed", applySettings);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("g3-theme-changed", applySettings);
    };
  }, []);
  return settings;
}

/**
 * An app icon (the address of its SVG) with its accent in the team's brand colour. Gives back
 * the icon as it is until the recoloured one is ready, for a team with the default colour, and
 * for anything that isn't an SVG.
 */
export function useTeamIcon(src: string | undefined): string | undefined {
  const color = useSyncExternalStore(
    subscribe,
    () => brandColor(current),
    () => brandColor(initial),
  );
  const [recolored, setRecolored] = useState<{ key: string; src: string } | null>(null);
  const key = `${color} ${src}`;
  const wanted = !!src && !isIconAccent(color);
  useEffect(() => {
    if (!wanted || !src) return;
    let cancelled = false;
    void loadIconSvg(src).then((svg) => {
      if (svg && !cancelled) {
        setRecolored({ key, src: iconDataUrl(recolorIcon(svg, color)) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, src, key, color]);
  return wanted && recolored?.key === key ? recolored.src : src;
}

/**
 * The page's team's names, for text a team sees (roadmap 2.10): from its Team Appearance settings,
 * and its number from the page's address. Use these, not site-config's build-time wordmark,
 * appTitle, idName and site.team, which only know the site's team.
 */
export function useTeamNames() {
  const settings = useTeamUiSettings();
  const { name, shortName } = settings;
  return {
    name,
    shortName,
    number: pageTeamNumber,
    /** "G3 SHOP". */
    wordmark: (app: string) => `${shortName} ${app}`.toUpperCase(),
    /** "G3 Shop". */
    appTitle: (app: string) => `${shortName} ${app}`,
    /** The sign-in app's name: "G3ID". */
    idName: `${shortName}ID`,
    links: settings.links,
  };
}
