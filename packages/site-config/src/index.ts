import { site } from "./site.ts";

// Everything apps and workers need from site.ts, already put together.

export { site };

export type AppName = keyof typeof site.apps;

/** An app's page, e.g. https://shop.g3robotics.com. */
export function appUrl(app: AppName): string {
  return `https://${site.apps[app].web}.${site.domain}`;
}

/** An app's API (its worker, at /api on the app's own address), e.g. https://shop.g3robotics.com/api. */
export function apiUrl(app: AppName): string {
  return `${appUrl(app)}/api`;
}

/**
 * Another app's API, called from an app's page: `/api/~<app>` on the page's own address. The
 * gateway sends it to that app (Vite's dev proxy does in dev), so the call is same-origin and
 * always for the page's own team. E.g. `${apiPath("id")}/auth/me`.
 */
export function apiPath(app: AppName): string {
  return `/api/~${app}`;
}

// Teams. The team in this file uses the app addresses above. Every team also has its own, by FRC
// number: <number>-<app>.<domain> for an app and <number>.<domain> for its home (Portal). The
// gateway (workers/gateway) answers them all.

/** Each app's name in team addresses. Portal is the team's home, at <number>.<domain>. */
export const TEAM_HOST_APPS = {
  id: "id",
  shop: "shop",
  pit: "pit",
  orders: "orders",
  edge: "edge",
  scouting: "scouting",
  skillTree: "skill-tree",
  attendance: "attendance",
} as const satisfies Record<Exclude<AppName, "portal">, string>;

/** A team's address for an app. The site's own team keeps the app addresses above. */
export function teamAppUrl(teamId: string, app: AppName): string {
  if (teamId === teamKey) return appUrl(app);
  const number = teamId.replace(/^frc/, "");
  const host = app === "portal" ? number : `${number}-${TEAM_HOST_APPS[app]}`;
  return `https://${host}.${site.domain}`;
}

/** The team a hostname belongs to (its key, "frc<number>"), or null for any other hostname. */
export function teamOfHost(hostname: string): string | null {
  for (const { web, api } of Object.values(site.apps)) {
    if (hostname === `${web}.${site.domain}` || (api && hostname === `${api}.${site.domain}`)) {
      return teamKey;
    }
  }
  if (!hostname.endsWith(`.${site.domain}`)) return null;
  const number = hostname.slice(0, -site.domain.length - 1).match(/^([1-9]\d*)(?:-|$)/)?.[1];
  return number ? `frc${number}` : null;
}

/**
 * Where sign-in providers (Google, GitHub, Steam, Onshape) send people back: G3ID's API on the
 * platform's id.<domain> host, one address for every team. The team travels in the sign-in's state.
 */
export const signInCallbackApiUrl = `https://id.${site.domain}/api`;

/** The app list every app links back to. */
export const allAppsUrl = appUrl("portal");

/** The shop edge box's tunnel URL. */
export const edgeAgentUrl = `https://${site.edgeAgentSubdomain}.${site.domain}`;

/** An app's wordmark: "G3 SHOP". */
export const wordmark = (app: string) => `${site.team.shortName} ${app}`.toUpperCase();

/** An app's name in text: "G3 Shop". */
export const appTitle = (app: string) => `${site.team.shortName} ${app}`;

/** The sign-in service's name, as people see it ("G3ID"). */
export const idName = `${site.team.shortName}ID`;

/** The team's pages on FIRST's event site and FRC stats sites. */
export const teamLinks = {
  frcEvents: `https://frc-events.firstinspires.org/team/${site.team.number}`,
  blueAlliance: `https://www.thebluealliance.com/team/${site.team.number}`,
  statbotics: `https://www.statbotics.io/team/${site.team.number}`,
  match13: `https://www.match13.com/team/${site.team.number}`,
};

/** The Blue Alliance's key for the team ("frc1648"). */
export const teamKey = `frc${site.team.number}`;

/**
 * CORS: which browser origins may call the workers with credentials. The team's own domain and
 * its subdomains over https, and localhost for development. Nothing else (no *.pages.dev
 * previews: anyone can publish one).
 */
export function isAllowedOrigin(origin: string): boolean {
  if (origin === `https://${site.domain}`) return true;
  if (origin.startsWith("https://") && origin.endsWith(`.${site.domain}`)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** For Hono's cors({ origin }): the origin if it's allowed, else none. */
export const corsOrigin = (origin: string | undefined): string | null =>
  origin && isAllowedOrigin(origin) ? origin : null;
