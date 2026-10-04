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
