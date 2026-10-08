import { site } from "./site.ts";

// Everything apps and workers need from site.ts, already put together.

export { site };
export { type Hsv, hexToHsv, hsvToHex, isHexColor, withHueOf } from "./color.ts";
export {
  brandColor,
  builtInBrandColor,
  completeAppOrder,
  defaultAppOrder,
  defaultTeamUiSettings,
  isPortalTileKey,
  portalAppLabels,
  teamUiDefaults,
  teamUiLinkLabels,
  type PortalTileKey,
  type TeamUiColors,
  type TeamUiSettings,
  type TeamUiLinkKey,
} from "./team-ui.ts";

export type AppName = keyof typeof site.apps;

/** The Blue Alliance's key for the team ("frc1648"). */
export const teamKey = `frc${site.team.number}`;

declare const __G3_LOCAL_GATEWAY__: string | undefined;

/**
 * Local dev: the dev gateway (http://localhost:8796, roadmap 2.9), set for pages by the
 * siteConfig() Vite plugin in dev. Every address below then goes through it
 * (http://1648-orders.gearbox.localhost:8796), so links stay on your machine. Undefined in production
 * builds and in workers, which get it as LOCAL_GATEWAY_URL and pass it to teamAppUrlVia.
 */
export const localGateway: string | undefined =
  typeof __G3_LOCAL_GATEWAY__ === "string" ? __G3_LOCAL_GATEWAY__ : undefined;

/**
 * Local dev: the domain that stands for the platform's on the dev gateway. A name under
 * localhost, so it resolves to your machine, but not localhost itself: browsers won't share a
 * cookie for "localhost" across its subdomains, and they do for gearbox.localhost.
 */
export const DEV_DOMAIN = "gearbox.localhost";

/** `host` on the dev gateway: http://<host>.gearbox.localhost:8796 (the domain itself for ""). */
function onGateway(gateway: string, host: string): string {
  const { protocol, port } = new URL(gateway);
  return `${protocol}//${host ? `${host}.` : ""}${DEV_DOMAIN}${port ? `:${port}` : ""}`;
}

/** The platform's address, or given the dev gateway, its address there (http://gearbox.localhost:8796). */
export function platformUrlVia(gateway: string | undefined): string {
  return gateway ? onGateway(gateway, "") : `https://${site.platformDomain}`;
}

/**
 * The team the current page is for, from its address (roadmap 2.10): the site team's own addresses
 * and plain localhost are the site team, <number>-<app>.<platform domain> (or, in dev,
 * .gearbox.localhost) is team <number>. Outside a browser (workers, builds), the site team.
 */
const pageHost = (globalThis as { location?: { hostname: string } }).location?.hostname;
export const pageTeamId: string = (pageHost ? teamOfHost(pageHost) : null) ?? teamKey;

/** The page's team's FRC number. */
export const pageTeamNumber = Number(pageTeamId.replace(/^frc/, ""));

/** An app's page for the page's team, e.g. https://shop.g3robotics.com (or through the dev gateway). */
export function appUrl(app: AppName): string {
  return teamAppUrlVia(localGateway, pageTeamId, app);
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

// Teams. The team in this file uses the app addresses above, on its own domain. Every other team
// has its addresses on the platform's domain, by FRC number: <number>-<app>.<platform domain> for
// an app and <number>.<platform domain> for its home (Portal). The gateway answers them all.

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
  inventory: "inventory",
} as const satisfies Record<Exclude<AppName, "portal">, string>;

/** A team's address for an app. The site's own team keeps the app addresses above. */
export function teamAppUrl(teamId: string, app: AppName): string {
  return teamAppUrlVia(localGateway, teamId, app);
}

/**
 * A team's address for an app on the platform's domain (https://1648-orders.frcgearbox.com), or,
 * given the local dev gateway (`LOCAL_GATEWAY_URL` in a worker), the same address through it:
 * http://1648-orders.gearbox.localhost:8796.
 */
export function teamAppUrlVia(gateway: string | undefined, teamId: string, app: AppName): string {
  const number = teamId.replace(/^frc/, "");
  const host = app === "portal" ? number : `${number}-${TEAM_HOST_APPS[app]}`;
  if (gateway) return onGateway(gateway, host);
  return `https://${host}.${site.platformDomain}`;
}

/** The team a hostname belongs to (its key, "frc<number>"), or null for any other hostname. */
export function teamOfHost(hostname: string): string | null {
  // Plain localhost (each app on its own dev port) is the site's team.
  if (hostname === "localhost") return teamKey;
  // A team address on the platform's domain, or the dev gateway's (gearbox.localhost) for it.
  const parent = [site.platformDomain, DEV_DOMAIN].find((d) => hostname.endsWith(`.${d}`));
  if (!parent) return null;
  const label = hostname.slice(0, -parent.length - 1);
  const number = label.match(/^([1-9]\d*)(?:-|$)/)?.[1];
  return number ? `frc${number}` : null;
}

/** The platform's public site and team sign-up. */
export const platformUrl = platformUrlVia(localGateway);

/**
 * The platform operators' console (roadmap 2.8), served by the platform worker at
 * admin.<platform domain>, where every operator's session cookie is.
 */
export const CONSOLE_HOSTS = [`admin.${site.platformDomain}`] as const;

/** The console's address (`teamId`, the operator's team, no longer changes it). */
export function consoleUrl(_teamId?: string): string {
  if (localGateway) return onGateway(localGateway, "admin");
  return `https://admin.${site.platformDomain}`;
}

/**
 * Where sign-in providers (Google, GitHub, Steam, Onshape) send people back: G3ID's API on the
 * platform's id.<platform domain> host, one address for every team. The team travels in the
 * sign-in's state. (`teamId` no longer changes it.)
 */
export function signInCallbackApiUrl(_teamId?: string): string {
  return `https://id.${site.platformDomain}/api`;
}

/** The app list every app links back to. */
export const allAppsUrl = appUrl("portal");

/** An app's wordmark: "G3 SHOP". */
export const wordmark = (app: string) => `${site.team.shortName} ${app}`.toUpperCase();

/** An app's name in text: "G3 Shop". */
export const appTitle = (app: string) => `${site.team.shortName} ${app}`;

/** The sign-in service's name, as people see it ("G3ID"). */
export const idName = `${site.team.shortName}ID`;

export { teamLinks, teamLinksFor, toolLinks } from "./team-links.ts";

/**
 * CORS: which browser origins may call the workers with credentials. The platform's domain and its
 * subdomains over https, and localhost for development. Nothing else (no *.pages.dev previews:
 * anyone can publish one).
 */
export function isAllowedOrigin(origin: string): boolean {
  const domain = site.platformDomain;
  if (
    origin === `https://${domain}` ||
    (origin.startsWith("https://") && origin.endsWith(`.${domain}`))
  ) {
    return true;
  }
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** For Hono's cors({ origin }): the origin if it's allowed, else none. */
export const corsOrigin = (origin: string | undefined): string | null =>
  origin && isAllowedOrigin(origin) ? origin : null;
