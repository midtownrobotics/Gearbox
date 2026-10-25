import { apiPath } from "@g3/site-config";
import { DOCS_FEATURES, type DocsFeature } from "@g3/site-config/help";
import { useEffect, useState, useSyncExternalStore } from "react";
import { sharedCookieAttributes } from "./shared-cookie";

// Tutorial mode (computers only): the app takes the left two thirds of the window and the docs
// page about the page you're on the right third (TutorialPanel, opened from the bar's menu). One
// setting for every app, in a cookie like light/dark, so it stays on from app to app.
//
// While the panel is open, <html> has `data-tutorial` (nav-bar.css): the body is narrowed and made
// the box fixed elements are placed in, so dialogs, drawers and full-screen views fill the app's
// part of the window rather than covering the docs; and `#root` scrolls instead of the window.
// Code that scrolls the page uses `pageScroller()` / `scrollPageToTop()`, never `window.scrollTo`.

const COOKIE = "g3_tutorial";
const listeners = new Set<() => void>();

/** The narrowest window the panel opens in: the app keeps at least 800px. */
export const TUTORIAL_MIN_WIDTH = 1200;

const readTutorial = () => /(?:^|;\s*)g3_tutorial=1/.test(document.cookie);

/** Turns tutorial mode on or off, in every app. */
export function setTutorial(on: boolean) {
  document.cookie = `${COOKIE}=${on ? "1" : "0"}; ${sharedCookieAttributes(on ? 60 * 60 * 24 * 365 : 0)}`;
  for (const listener of listeners) listener();
}

/** Whether tutorial mode is on (it may be on in another app, so it's read again on focus). */
export function useTutorial(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      window.addEventListener("focus", listener);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("focus", listener);
      };
    },
    readTutorial,
    () => false,
  );
}

/** Whether the window is wide enough for the panel. */
export function useTutorialFits(): boolean {
  const query = `(min-width: ${TUTORIAL_MIN_WIDTH}px)`;
  const [fits, setFits] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setFits(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [query]);
  return fits;
}

/** The element the page scrolls in: `#root` while the tutorial panel is open, else the window's. */
export function pageScroller(): HTMLElement {
  const root = document.getElementById("root");
  if (root && document.documentElement.hasAttribute("data-tutorial")) return root;
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** Scrolls the page back to its top. */
export function scrollPageToTop(behavior: ScrollBehavior = "auto") {
  pageScroller().scrollTo({ top: 0, behavior });
}

/**
 * Stops the page scrolling under a drawer or overlay; call the result to undo it. It locks the
 * element the page scrolls in: never the body in tutorial mode, which would hide the panel.
 */
export function lockPageScroll(): () => void {
  const root = document.getElementById("root");
  const element = root && pageScroller() === root ? root : document.body;
  const overflow = element.style.overflow;
  element.style.overflow = "hidden";
  return () => {
    element.style.overflow = overflow;
  };
}

/**
 * What the docs page in a tutorial panel tells the app beside it whenever it shows another page
 * (docs-app.tsx, with postMessage), so the app follows it as it follows the app (TutorialPanel).
 */
export type TutorialDocMessage = {
  type: "gearbox-docs-page";
  /** The docs page's own path (/orders/budget), so the panel doesn't load it again. */
  pathname: string;
  /** The docs section and page (`slug` "" for its front page). */
  section: string;
  slug: string;
  /** The app the page is about (its key in site.apps), and the app page to open; null for none. */
  app: string | null;
  path: string | null;
};

export const isTutorialDocMessage = (data: unknown): data is TutorialDocMessage =>
  typeof data === "object" &&
  data !== null &&
  (data as { type?: unknown }).type === "gearbox-docs-page" &&
  typeof (data as { pathname?: unknown }).pathname === "string";

/**
 * Goes to another page of this app without reloading it: every app uses react-router's
 * BrowserRouter, which follows the address on a popstate event.
 */
export function navigateInApp(path: string) {
  if (`${window.location.pathname}${window.location.search}` === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * What the app tells the docs page in its tutorial panel, so the docs' previous and next links
 * skip what the reader can't open: the apps the team has on, and the reader's role (each null
 * when it doesn't know). Only the panel sends it: the docs site on its own shows every page.
 */
export type TutorialAppsMessage = {
  type: "gearbox-tutorial-apps";
  apps: string[] | null;
  /** "admin", "mentor" or "member" (a student, or anyone on a kiosk). */
  role: TutorialRole | null;
  /** The parts of apps the team has switched off (`feature:` in a doc), null until known. */
  featuresOff: string[] | null;
};

export type TutorialRole = "admin" | "mentor" | "member";

export const isTutorialAppsMessage = (data: unknown): data is TutorialAppsMessage =>
  typeof data === "object" &&
  data !== null &&
  (data as { type?: unknown }).type === "gearbox-tutorial-apps" &&
  ((data as { apps?: unknown }).apps === null ||
    (Array.isArray((data as { apps?: unknown }).apps) &&
      (data as { apps: unknown[] }).apps.every((app) => typeof app === "string")));

const HANDOFF = "g3_tutorial_doc";

/**
 * Before following the panel to another app: the docs page the reader chose (its path), for the
 * next app's panel to open instead of the doc about the page it lands on. Kept for 30 seconds.
 */
export function handOffDoc(pathname: string) {
  document.cookie = `${HANDOFF}=${encodeURIComponent(pathname)}; ${sharedCookieAttributes(30)}`;
}

/** The docs page handed over by the app before (see `handOffDoc`), once; null when none. */
export function takeHandedOffDoc(): string | null {
  const value = document.cookie.match(/(?:^|;\s*)g3_tutorial_doc=([^;]*)/)?.[1];
  if (value === undefined) return null;
  document.cookie = `${HANDOFF}=; ${sharedCookieAttributes(0)}`;
  const pathname = decodeURIComponent(value);
  return /^\/[\w\-/]*$/.test(pathname) ? pathname : null;
}

/** The app each feature belongs to: it's off whenever its app is. */
const FEATURE_APPS: Record<DocsFeature, string> = { "scouting-points": "scouting" };

/** Whether the team has a feature on, asked of its app (as the member), or null when it can't tell. */
async function featureOn(feature: DocsFeature): Promise<boolean | null> {
  try {
    if (feature === "scouting-points") {
      const res = await fetch(`${apiPath("scouting")}/scouting/engagement-settings`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      return ((await res.json()) as { enabled?: boolean }).enabled === true;
    }
  } catch {}
  return null;
}

/**
 * The features (DOCS_FEATURES) the team has off, for the tutorial panel: asked once its apps are
 * known, of each app that's on (an app that's off has all its features off). Null until known.
 */
export function useFeaturesOff(apps: string[] | null): string[] | null {
  const [off, setOff] = useState<string[] | null>(null);
  const key = apps ? apps.join(",") : null;
  useEffect(() => {
    if (key === null) return setOff(null);
    const on = new Set(key.split(","));
    let live = true;
    Promise.all(
      DOCS_FEATURES.map(async (feature) =>
        !on.has(FEATURE_APPS[feature]) || (await featureOn(feature)) === false ? feature : null,
      ),
    ).then((found) => {
      if (live) setOff(found.filter((f): f is DocsFeature => f !== null));
    });
    return () => {
      live = false;
    };
  }, [key]);
  return off;
}
