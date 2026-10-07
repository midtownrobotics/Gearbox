import { DEV_DOMAIN, site } from "@g3/site-config";
import { useEffect, useSyncExternalStore } from "react";

// One light/dark setting for every app. It lives in a cookie on the team's domain, which every
// app's subdomain can read (localStorage is per subdomain). On localhost, cookies are shared
// across ports, so dev servers share it too. With no cookie, the system setting decides.

export type Theme = "light" | "dark";
let defaultTheme: Theme | "system" = "system";
/** A page that must always look one way (Attendance's kiosk display, on a shop TV). */
let forcedTheme: Theme | null = null;

const COOKIE = "g3_theme";
const listeners = new Set<() => void>();

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The saved theme, or the system's when none is saved. */
export function readTheme(): Theme {
  if (forcedTheme) return forcedTheme;
  const saved = document.cookie.match(/(?:^|;\s*)g3_theme=(light|dark)/)?.[1];
  return (saved as Theme | undefined) ?? (defaultTheme === "system" ? systemTheme() : defaultTheme);
}

/**
 * Pins this page to one theme whatever the saved setting or the team's default says (null lets
 * the setting decide again). Doesn't change the saved setting other apps use.
 */
export function forceTheme(theme: Theme | null) {
  forcedTheme = theme;
  applyTheme(readTheme());
}

/** Team choice applies only when the member has not saved a personal preference. */
export function setDefaultTheme(theme: Theme | "system") {
  defaultTheme = theme;
  applyTheme(readTheme());
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  window.dispatchEvent(new Event("g3-theme-changed"));
  // The browser's own bar matches the app's top bar.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#262626" : "#fefefe");
  for (const listener of listeners) listener();
}

/** Saves the theme for every G3 app and applies it here. */
export function setTheme(theme: Theme) {
  // Shared by every app on the domain this page is on: the platform's, or in dev the gateway's
  // (gearbox.localhost) or plain localhost.
  const host = window.location.hostname;
  const shared = [site.platformDomain, DEV_DOMAIN, "localhost"].find(
    (d) => host === d || host.endsWith(`.${d}`),
  );
  const domain = shared ? `; domain=${shared}` : "";
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax${domain}${secure}`;
  applyTheme(theme);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const current = () => (document.documentElement.dataset.theme as Theme | undefined) ?? "light";

/**
 * The current theme and a setter. A change made in another G3 app (another tab) shows up when
 * this tab is focused again.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);
  useEffect(() => {
    const sync = () => applyTheme(readTheme());
    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return [theme, setTheme];
}
