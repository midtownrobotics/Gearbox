import {
  type TeamUiColors,
  type TeamUiSettings,
  apiPath,
  defaultTeamUiSettings,
  pageTeamId,
  pageTeamNumber,
  teamUiDefaults,
} from "@g3/site-config";
import { useEffect, useSyncExternalStore } from "react";
import { setDefaultTheme } from "./theme";

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

function applyColors(colors: TeamUiColors) {
  const style = document.documentElement.style;
  for (const [key, color] of Object.entries(colors)) style.setProperty(`--g3-${key}`, color);
}

function applySettings() {
  const root = document.documentElement;
  applyColors(root.dataset.theme === "dark" ? current.dark : current.light);
  root.style.setProperty(
    "--font-display",
    current.displayFont === "system-ui" ? "system-ui" : `"${current.displayFont}", sans-serif`,
  );
  // Tailwind utilities resolve these variables at runtime across all apps.
  const base = current.primaryColor;
  const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  const blends = [90, 75, 55, 35, 18, 0, 15, 30, 45, 60];
  for (let i = 0; i < steps.length; i++) {
    if (base === defaultTeamUiSettings.primaryColor) {
      root.style.removeProperty(`--color-primary-${steps[i]}`);
      continue;
    }
    const shade =
      i < 5
        ? `color-mix(in srgb, ${base}, white ${blends[i]}%)`
        : i === 5
          ? base
          : `color-mix(in srgb, ${base}, black ${blends[i]}%)`;
    root.style.setProperty(`--color-primary-${steps[i]}`, shade);
  }
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
