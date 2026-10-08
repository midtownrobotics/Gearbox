import {
  type AppName,
  CONSOLE_HOSTS,
  DEV_DOMAIN,
  TEAM_HOST_APPS,
  isAllowedOrigin,
  portalAppLabels,
  site,
  teamAppUrl,
  teamKey,
} from "@g3/site-config";
import devPorts from "../../../.dev-ports.json";

// The one worker on the platform's domain (and *.<domain>, the site team's own, for its retired
// addresses): works out the team and app from the hostname and sends the request to that app's
// worker. Each app's worker serves the app's page and its API at /api (see
// @g3/site-config/worker). <platform> is site.ts's `platformDomain`, where every team's apps are,
// G3's included; <domain> its `domain`, G3's own (its public website).
//   <platform>/, www.<platform>/   → the platform worker: public site and team sign-up
//   admin.<platform>/              → the platform worker: the operators' console
//   <number>.<platform>/...        → that team's home (Portal)
//   <number>-<app>.<platform>/...  → the app, for team <number>
//   <any of those>/api/~<app>/...  → another app's /api/..., for the same team: how one app's page
//                                    calls another's API (`apiPath` in @g3/site-config)
//   id.<platform>/                 → G3ID, for no team: where sign-in providers call back
//                                    (`signInCallbackApiUrl`); the team is in the sign-in's state
//   <app>.<domain>, api.<app>.<domain>, id.<domain>, admin.<domain>
//                                  → 410 Gone, naming the new address: G3's old addresses, retired
//   any other <x>.<platform>       → the platform's not-found page (JSON 404 for API calls)
//   anything else                  → passed on to wherever its DNS points (www)
// /api/internal/... is for workers only (over service bindings) and never answered here.
//
// Local dev (roadmap 2.9; `LOCAL_DEV` in wrangler.toml's dev settings, `pnpm dev`): the gateway
// runs on one port (8796), with gearbox.localhost standing for the platform's domain:
// gearbox.localhost:8796 is the platform, 254-orders.gearbox.localhost:8796 team 254's Orders,
// 1648-id.gearbox.localhost:8796 this team's G3ID. /api goes to each app's local worker, pages to its Vite dev server (.dev-ports.json).
//
// On the way it keeps teams apart (roadmap step 2.3):
// - A team-number host only answers for a team the platform has (signed up and active), and an
//   app's address (and /api/~<app>) only for an app the team has switched on (roadmap 4.6): any
//   other answers "not enabled". Sign-in, the team's home and the platform's API are always on.
//   What the platform says is remembered for a minute, so a change shows within one.
// - A session belonging to another team's member is dropped: the app sees a signed-out request.
// - An /api request from another team's page (its Origin) is refused. Every app's CORS allows the
//   whole domain, so without this one team's page could call another team's API with a member's
//   cookie.
// - The app gets the team and the signed-in user as headers (IDENTITY_HEADERS); copies a client
//   sent are removed first. Apps don't rely on them yet; production app workers have no
//   workers.dev address, so these headers can only come from here.

/** An app, or the platform itself. */
type Worker = AppName | "platform";

export type Env = Record<(typeof BINDINGS)[Worker], Fetcher> & {
  /** "true" in local dev (see above). */
  LOCAL_DEV?: string;
};

/** The service binding for each worker (wrangler.toml). */
const BINDINGS = {
  platform: "PLATFORM",
  id: "G3ID",
  portal: "PORTAL",
  shop: "SHOP",
  pit: "PIT",
  orders: "ORDERS",
  edge: "EDGE",
  scouting: "SCOUTING",
  skillTree: "SKILL_TREE",
  attendance: "ATTENDANCE",
  inventory: "INVENTORY",
} as const satisfies Record<Worker, string>;

/** Headers only the gateway sets. */
export const IDENTITY_HEADERS = {
  /** The team the hostname is for: its key, "frc<number>". */
  team: "X-Team-Id",
  /** The signed-in user, when their session belongs to that team. */
  user: "X-User-Id",
  /** "oauth", or "pin" on a shop kiosk. */
  sessionType: "X-Session-Type",
  /** Comma-separated: "admin", "mentor" (never on a kiosk PIN session). */
  roles: "X-User-Roles",
} as const;

/** `team` is null on platform hosts, which serve every team. */
type Route = { app: Worker; team: string | null };

/** Platform hosts: the same for every team. */
const PLATFORM_ROUTES = new Map<string, Route>([
  [site.platformDomain, { app: "platform", team: null }],
  [`www.${site.platformDomain}`, { app: "platform", team: null }],
  ...CONSOLE_HOSTS.map((host): [string, Route] => [host, { app: "platform", team: null }]),
  [`id.${site.platformDomain}`, { app: "id", team: null }],
]);

/**
 * G3's old addresses on its own domain, retired when it moved to the platform's: each app's
 * (<web>.<domain>) and its older API address (api.<web>.<domain>), and the sign-in callback and
 * console hosts. Each maps to the address to use instead.
 */
const RETIRED_HOSTS = new Map<string, string>([
  ...(Object.keys(site.apps) as AppName[]).flatMap((app): [string, string][] => {
    const { web } = site.apps[app];
    // An app made since the move never had an address there.
    if (web === null) return [];
    return [
      [`${web}.${site.domain}`, teamAppUrl(teamKey, app)],
      [`api.${web}.${site.domain}`, `${teamAppUrl(teamKey, app)}/api`],
    ];
  }),
  [`id.${site.domain}`, `https://id.${site.platformDomain}`],
  [`admin.${site.domain}`, `https://admin.${site.platformDomain}`],
]);

/** A retired address's replacement (see RETIRED_HOSTS), or null. */
export function retiredHost(hostname: string): string | null {
  return RETIRED_HOSTS.get(hostname) ?? null;
}

/** 410 Gone for a retired address: a short page naming the new one (JSON for API calls). */
function gone(request: Request, moved: string): Response {
  const accept = request.headers.get("Accept") ?? "";
  if (!accept.includes("text/html")) {
    return Response.json(
      { error: `This address was retired. Use ${moved} instead.`, use: moved },
      { status: 410 },
    );
  }
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>This address has moved</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5"><h1>This address has moved</h1><p>It no longer works. Use <a href="${moved}">${moved}</a> instead, and update your bookmarks.</p></body>`;
  return new Response(page, {
    status: 410,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const TEAM_HOST_APP = new Map<string, AppName>(
  Object.entries(TEAM_HOST_APPS).map(([app, host]) => [host, app as AppName]),
);

/**
 * The app and team a hostname is for; "unknown app" for a team host naming no app; null for a
 * hostname that isn't an app at all.
 */
export function route(hostname: string): Route | "unknown app" | null {
  const known = PLATFORM_ROUTES.get(hostname);
  if (known) return known;
  if (!hostname.endsWith(`.${site.platformDomain}`)) return null;
  const label = hostname.slice(0, -site.platformDomain.length - 1);
  const match = label.match(/^([1-9]\d*)(?:-(.+))?$/);
  if (!match) return null;
  const app = match[2] === undefined ? "portal" : TEAM_HOST_APP.get(match[2]);
  if (!app) return "unknown app";
  return { app, team: `frc${match[1]}` };
}

/**
 * Whether a page at `origin` may call a team's API: one of the team's own pages, or a page of no
 * team (www, the platform's hosts, localhost). A platform host's API takes any of the domain's.
 */
function originAllowed(origin: string, team: string | null, local: boolean): boolean {
  // A page on the dev gateway is checked as the platform address it stands for.
  const stands = local ? fromLocalHost(new URL(origin).hostname) : null;
  const checked = stands ? `https://${stands}` : origin;
  if (!isAllowedOrigin(checked)) return false;
  const from = route(new URL(checked).hostname);
  if (team === null || from === null) return true;
  return from !== "unknown app" && (from.team === null || from.team === team);
}

// Lookups through the platform and G3ID, remembered for a minute in this isolate: a team never disappears in a
// minute, and a session's team never changes (an account belongs to one team). A session signed
// out in that minute still gets identity headers; apps still check the session with G3ID
// themselves, and must not trust the headers alone until that's handled (roadmap Phase 3).
const TTL_MS = 60_000;
const MAX_ENTRIES = 1000;

function memo<T>() {
  const entries = new Map<string, { value: T; until: number }>();
  return async (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await load();
    if (entries.size >= MAX_ENTRIES) entries.clear();
    entries.set(key, { value, until: Date.now() + TTL_MS });
    return value;
  };
}

/** A team's apps that are on (null: no such team; "all": the platform didn't say). */
type TeamApps = readonly string[] | "all" | null;
const teamApps = memo<TeamApps>();

/** Always on for every team: sign-in, the team's home, and the platform's own API. */
const ALWAYS_ON = new Set<Worker>(["id", "portal", "platform"]);

async function loadTeamApps(env: Env, team: string): Promise<TeamApps> {
  let res: Response;
  try {
    res = await env.PLATFORM.fetch(`http://platform/api/teams/${team}`);
  } catch (err) {
    // The site's own team keeps working while the platform is down.
    if (team === teamKey) return "all";
    throw err;
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    if (team === teamKey) return "all";
    throw new Error(`platform /teams: ${res.status}`);
  }
  const { apps } = (await res.json()) as { apps?: string[] };
  // A platform from before the app library: every app.
  return apps ?? "all";
}

const appEnabled = (apps: TeamApps, app: Worker) =>
  ALWAYS_ON.has(app) || apps === "all" || (apps?.includes(app) ?? false);

/**
 * A team-number address for a team the platform doesn't have: a page goes to the platform's
 * team-not-found page (another number, or sign it up); an API call gets JSON.
 */
function noSuchTeam(request: Request, url: URL, team: string, local: boolean): Response {
  if (!wantsPage(request, url)) return json(404, "No such team.");
  const number = team.replace(/^frc/, "");
  return Response.redirect(`${platformOrigin(url, local)}/team-not-found?team=${number}`, 302);
}

/**
 * An address on the platform's domain that's nothing (no app, no team pattern): a page goes to
 * the platform's not-found page, naming the address; anything else gets JSON.
 */
function nothingHere(request: Request, url: URL, local: boolean, error: string): Response {
  if (!wantsPage(request, url)) return json(404, error);
  const host = encodeURIComponent(url.hostname);
  return Response.redirect(`${platformOrigin(url, local)}/not-found?host=${host}`, 302);
}

/** A browser asking for a page (not an API call). */
function wantsPage(request: Request, url: URL): boolean {
  const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
  return !isApi && (request.headers.get("Accept") ?? "").includes("text/html");
}

/** The platform's own site: https://<platform>, or in dev the gateway's gearbox.localhost. */
function platformOrigin(url: URL, local: boolean): string {
  if (!local) return `https://${site.platformDomain}`;
  return `${url.protocol}//${DEV_DOMAIN}${url.port ? `:${url.port}` : ""}`;
}

/** The team's home for a team address: <number>-<app>.<domain> → <number>.<domain>. */
function homeOf(url: URL): string {
  const [first, ...rest] = url.hostname.split(".");
  const number = first.split("-")[0];
  return `${url.protocol}//${[number, ...rest].join(".")}${url.port ? `:${url.port}` : ""}`;
}

/** An app the team hasn't switched on: a short page (JSON for API calls). */
function notEnabled(request: Request, app: Worker, home: string): Response {
  const name = app in portalAppLabels ? portalAppLabels[app as keyof typeof portalAppLabels] : app;
  const message = `${name} isn't switched on for this team.`;
  const accept = request.headers.get("Accept") ?? "";
  if (!accept.includes("text/html")) {
    return Response.json({ error: message, code: "app_not_enabled" }, { status: 404 });
  }
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} isn't on</title><style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f6f7;color:#1a1a1a}@media (prefers-color-scheme:dark){body{background:#171717;color:#ededed}}main{max-width:28rem;padding:1.5rem;text-align:center}a{color:inherit}</style></head><body><main><h1>${message}</h1><p>A team admin can switch it on under Apps on the <a href="${home}/admin">team's admin pages</a>.</p><p><a href="${home}/">Back to the team's home</a></p></main></body></html>`;
  return new Response(body, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
const sessionIdentity = memo<Identity | null>();

type Identity = {
  id: string;
  teamId: string;
  sessionType?: "oauth" | "pin";
  isAdmin?: boolean;
  isMentor?: boolean;
};

async function loadIdentity(env: Env, sessionCookie: string): Promise<Identity | null> {
  const res = await env.G3ID.fetch(
    new Request("http://g3id/api/auth/me?includeIdentities=false", {
      headers: { Cookie: sessionCookie },
    }),
  );
  return res.ok ? ((await res.json()) as Identity) : null;
}

const SESSION_COOKIE = /(?:^|;\s*)g3_session=([^;]*)/;

function withoutSessionCookie(cookie: string): string {
  return cookie
    .split(/;\s*/)
    .filter((part) => !part.startsWith("g3_session="))
    .join("; ");
}

/**
 * Every app is https only. A page opened over http would send an http Origin, which no app's API
 * accepts, so an http request goes to https first (308 keeps the method and body). Null for https.
 */
export function toHttps(url: URL): Response | null {
  if (url.protocol !== "http:") return null;
  const secure = new URL(url);
  secure.protocol = "https:";
  return Response.redirect(secure.toString(), 308);
}

const json = (status: number, error: string) => Response.json({ error }, { status });

/**
 * Local dev: the platform address a dev hostname stands for, or null. gearbox.localhost stands for
 * the platform's domain (and so does plain localhost).
 */
export function fromLocalHost(hostname: string): string | null {
  if (hostname === DEV_DOMAIN || hostname === "localhost") return site.platformDomain;
  if (hostname.endsWith(`.${DEV_DOMAIN}`)) {
    return `${hostname.slice(0, -DEV_DOMAIN.length - 1)}.${site.platformDomain}`;
  }
  return null;
}

/** Local dev: each app's Vite dev server, which serves its pages (.dev-ports.json). */
const DEV_APPS: Record<Worker, keyof typeof devPorts.apps> = {
  platform: "platform",
  id: "g3id",
  portal: "portal",
  shop: "shop",
  pit: "pit",
  orders: "orders",
  edge: "edge",
  scouting: "scouting",
  skillTree: "skill-tree",
  attendance: "attendance",
  inventory: "inventory",
};

function devPage(request: Request, url: URL, app: Worker): Promise<Response> {
  const page = new URL(`${url.pathname}${url.search}`, devPorts.apps[DEV_APPS[app]].url);
  return fetch(new Request(page.toString(), request));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const localHost = env.LOCAL_DEV === "true" ? fromLocalHost(url.hostname) : null;
    const local = localHost !== null;
    const host = localHost ?? url.hostname;
    const target = route(host);
    // Any other name on the platform's domain is nothing: the platform's not-found page.
    if (target === null && host.endsWith(`.${site.platformDomain}`)) {
      return nothingHere(request, url, local, "Nothing is here.");
    }
    if (target === null) {
      const moved = retiredHost(url.hostname);
      if (moved) return gone(request, moved);
      // Not an app: let the request go where its DNS record points (a worker's own route doesn't
      // run again for its subrequests). If nothing is behind it, Cloudflare answers with an error.
      try {
        return await fetch(request);
      } catch {
        return new Response("Nothing is here.", { status: 502 });
      }
    }
    if (target === "unknown app") return nothingHere(request, url, local, "No such app.");

    const insecure = local ? null : toHttps(url);
    if (insecure) return insecure;

    const { team } = target;
    let apps: TeamApps = "all";
    if (team !== null) {
      try {
        apps = await teamApps(team, () => loadTeamApps(env, team));
      } catch (err) {
        console.error("[gateway] team lookup", err);
        return json(503, "Please try again in a minute.");
      }
      if (apps === null) return noSuchTeam(request, url, team, local);
    }
    if (!appEnabled(apps, target.app)) return notEnabled(request, target.app, homeOf(url));

    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
    const headers = new Headers(request.headers);
    for (const name of Object.values(IDENTITY_HEADERS)) headers.delete(name);
    if (team !== null) headers.set(IDENTITY_HEADERS.team, team);

    if (isApi) {
      const origin = request.headers.get("Origin");
      if (origin && !originAllowed(origin, team, local)) {
        return json(
          403,
          isAllowedOrigin(origin)
            ? "Requests from another team's pages aren't allowed."
            : "Requests from this page aren't allowed.",
        );
      }

      const cookie = request.headers.get("Cookie") ?? "";
      const session = cookie.match(SESSION_COOKIE)?.[1];
      if (session && team !== null) {
        const user = await sessionIdentity(session, () =>
          loadIdentity(env, `g3_session=${session}`),
        );
        if (user && user.teamId === team) {
          headers.set(IDENTITY_HEADERS.user, user.id);
          headers.set(IDENTITY_HEADERS.sessionType, user.sessionType ?? "oauth");
          const roles = [user.isAdmin && "admin", user.isMentor && "mentor"].filter(Boolean);
          headers.set(IDENTITY_HEADERS.roles, roles.join(","));
        } else if (user) {
          // Another team's member: to this team's apps they aren't signed in.
          headers.set("Cookie", withoutSessionCookie(cookie));
        }
      }
    }

    // Local dev: pages come from the app's Vite dev server (workers only serve them in production).
    if (local && !isApi) return devPage(request, url, target.app);

    let app: Worker = target.app;
    const other = url.pathname.match(/^\/api\/~([A-Za-z]+)(\/.*)?$/);
    if (other) {
      if (!(other[1] in BINDINGS)) return json(404, "No such app.");
      app = other[1] as Worker;
      if (!appEnabled(apps, app)) return notEnabled(request, app, homeOf(url));
      url.pathname = `/api${other[2] ?? "/"}`;
    }
    if (url.pathname === "/api/internal" || url.pathname.startsWith("/api/internal/")) {
      return json(404, "Not found.");
    }
    return env[BINDINGS[app]].fetch(new Request(url.toString(), new Request(request, { headers })));
  },
};
