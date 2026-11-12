// SPDX-License-Identifier: AGPL-3.0-only
import {
  type AppName,
  CONSOLE_HOSTS,
  DEMO_HOST_LABEL,
  DEV_DOMAIN,
  DOCS_HOSTS,
  TEAM_HOST_APPS,
  demoTeamId,
  isAllowedOrigin,
  isStaging,
  platformHost,
  platformLabel,
  portalAppLabels,
  site,
  teamAppUrl,
  teamAppUrlVia,
  teamHostLabel,
  teamKey,
  teamOfHostLabel,
} from "@g3/site-config";
import devPorts from "../../../.dev-ports.json";
import { limitRequestBody } from "./body-limit";
import { type DemoEnv, checkDemoRequest } from "./demo";
import { teamIcon } from "./icons";
import { type RateLimitEnv, checkRateLimit } from "./rate-limit";

// The one worker on the platform's domain (and *.<domain>, the site team's own, for its retired
// addresses): works out the team and app from the hostname and sends the request to that app's
// worker. Each app's worker serves the app's page and its API at /api (see
// @g3/site-config/worker). <platform> is site.ts's `platformDomain`, where every team's apps are,
// G3's included; <domain> its `domain`, G3's own (its public website).
//   <platform>/, www.<platform>/   → the platform worker: public site and team sign-up
//   admin.<platform>/              → the platform worker: the operators' console
//   docs.<platform>/               → the platform worker: the docs (setting up and using each app)
//   <number>.<platform>/...        → that FRC team's home (Portal)
//   <number>-<app>.<platform>/...  → the app, for FRC team <number>
//   ftc<number>.<platform>/..., ftc<number>-<app>.<platform>/...
//                                  → the same, for FTC team <number>
//   <any of those>/api/~<app>/...  → another app's /api/..., for the same team: how one app's page
//                                    calls another's API (`apiPath` in @g3/site-config)
//   demo.<platform>/               → redirected to the public demo team's home (roadmap Phase 5)
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
// gearbox.localhost:8796 is the platform, 9999-orders.gearbox.localhost:8796 team 9999's Orders,
// 1648-id.gearbox.localhost:8796 this team's G3ID. /api goes to each app's local worker, pages to its Vite dev server (.dev-ports.json).
//
// Staging (roadmap 0.2, `define` in wrangler.toml's [env.staging]): the same, with every platform
// address staging's (`platformHost` in @g3/site-config): 1648-orders-dev.g3robotics.com, the
// platform at dev.g3robotics.com. Its routes are only those names, and G3's retired addresses stay
// production's.
//
// On the way it keeps teams apart (roadmap step 2.3):
// - A team moved to another id (it changed program: the platform's src/moves.ts) is "moving" while
//   its data moves: its pages get a short page saying so, its API 503, except the platform's own
//   (the admin's page that started it). Once it's moved, its old addresses send pages to the same
//   page at the new ones and pass API calls on to the team (devices and webhooks set up with the
//   old address keep working), until another team signs up with the old id.
// - A team-number host only answers for a team the platform has (signed up and active), and an
//   app's address (and /api/~<app>) only for an app the team has switched on (roadmap 4.6): any
//   other answers "not enabled". Sign-in, the team's home and the platform's API are always on.
//   What the platform says is remembered for a minute, so a change shows within one.
// - A session belonging to another team's member is dropped: the app sees a signed-out request.
// - An /api request from another team's page (its Origin) is refused. Every app's CORS allows the
//   whole domain, so without this one team's page could call another team's API with a member's
//   cookie.
// - The public demo team's API (site.demo) is checked first (./demo.ts): blocked routes, a rate
//   limit on changes, no uploads, and only text the demo already has.
// - The app gets the team and the signed-in user as headers (IDENTITY_HEADERS); copies a client
//   sent are removed first. Apps don't rely on them yet; production app workers have no
//   workers.dev address, so these headers can only come from here.

/** An app, or the platform itself. */
type Worker = AppName | "platform";

export type Env = Record<(typeof BINDINGS)[Worker], Fetcher> &
  DemoEnv &
  RateLimitEnv & {
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
  schedule: "SCHEDULE",
} as const satisfies Record<Worker, string>;

/** Headers only the gateway sets. */
export const IDENTITY_HEADERS = {
  /** The team the hostname is for: its id, "frc1648" or "ftc12345". */
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
  [platformHost(""), { app: "platform", team: null }],
  [platformHost("www"), { app: "platform", team: null }],
  ...CONSOLE_HOSTS.map((host): [string, Route] => [host, { app: "platform", team: null }]),
  ...DOCS_HOSTS.map((host): [string, Route] => [host, { app: "platform", team: null }]),
  [platformHost("id"), { app: "id", team: null }],
]);

/**
 * G3's old addresses on its own domain, retired when it moved to the platform's: each app's
 * (<web>.<domain>) and its older API address (api.<web>.<domain>), and the sign-in callback and
 * console hosts. Each maps to the address to use instead.
 */
const RETIRED_HOSTS = new Map<string, string>(
  // Staging has none: they're production's.
  isStaging
    ? []
    : [
        ...(Object.keys(site.apps) as AppName[]).flatMap((app): [string, string][] => {
          const { web } = site.apps[app];
          // An app made since the move never had an address there.
          if (web === null) return [];
          return [
            [`${web}.${site.domain}`, teamAppUrl(teamKey, app)],
            [`api.${web}.${site.domain}`, `${teamAppUrl(teamKey, app)}/api`],
          ];
        }),
        [`id.${site.domain}`, `https://${platformHost("id")}`],
        [`admin.${site.domain}`, `https://${platformHost("admin")}`],
      ],
);

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
  const label = platformLabel(hostname);
  if (!label) return null;
  const match = label.match(/^((?:ftc)?[1-9]\d*)(?:-(.+))?$/);
  const team = match ? teamOfHostLabel(match[1]) : null;
  if (!match || !team) return null;
  const app = match[2] === undefined ? "portal" : TEAM_HOST_APP.get(match[2]);
  if (!app) return "unknown app";
  return { app, team };
}

/**
 * Whether a page at `origin` may call a team's API: one of the team's own pages, or a page of no
 * team (www, the platform's hosts; localhost in local dev). A platform host's API takes any of the
 * domain's.
 */
function originAllowed(origin: string, team: string | null, local: boolean): boolean {
  // A page on the dev gateway is checked as the platform address it stands for.
  const stands = local ? fromLocalHost(new URL(origin).hostname) : null;
  const checked = stands ? `https://${stands}` : origin;
  if (!isAllowedOrigin(checked, local)) return false;
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

/**
 * A team's apps that are on (null: no such team; "all": the platform didn't say), or where it's
 * moved to, or that it's moving.
 */
type TeamApps = readonly string[] | "all" | null | { movedTo: string } | "moving";
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
  if (res.status === 404) {
    const { movedTo } = (await res.json().catch(() => ({}))) as { movedTo?: unknown };
    return typeof movedTo === "string" && movedTo !== team ? { movedTo } : null;
  }
  if (!res.ok) {
    if (team === teamKey) return "all";
    throw new Error(`platform /teams: ${res.status}`);
  }
  const { apps, moving } = (await res.json()) as { apps?: string[]; moving?: boolean };
  if (moving) return "moving";
  // A platform from before the app library: every app.
  return apps ?? "all";
}

/** The apps of a team that's here: what the platform said, its moves aside. */
type OnApps = readonly string[] | "all";

const appEnabled = (apps: OnApps, app: Worker) =>
  ALWAYS_ON.has(app) || apps === "all" || apps.includes(app);

/** The same page at the team's new address (a team that moved: see above). */
function movedPage(url: URL, from: string, to: string): Response {
  const [first, ...rest] = url.hostname.split(".");
  const label = first.replace(new RegExp(`^${teamHostLabel(from)}(?=-|$)`), teamHostLabel(to));
  const moved = new URL(url);
  moved.hostname = [label, ...rest].join(".");
  return Response.redirect(moved.toString(), 302);
}

/** A team whose data is moving to its new id (see above): a short page, or 503 for an API call. */
function moving(request: Request): Response {
  const message = "This team's Gearbox is moving to its new address.";
  if (!(request.headers.get("Accept") ?? "").includes("text/html")) {
    return Response.json({ error: `${message} Try again in a minute.` }, { status: 503 });
  }
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>Moving</title><style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f6f7;color:#1a1a1a}@media (prefers-color-scheme:dark){body{background:#171717;color:#ededed}}main{max-width:28rem;padding:1.5rem;text-align:center}</style></head><body><main><h1>${message}</h1><p>This takes a minute or two. The page reloads by itself.</p></main></body></html>`;
  return new Response(body, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "30" },
  });
}

/**
 * A team-number address for a team the platform doesn't have: a page goes to the platform's
 * team-not-found page (another number, or sign it up); an API call gets JSON.
 */
function noSuchTeam(request: Request, url: URL, team: string, local: boolean): Response {
  if (!wantsPage(request, url)) return json(404, "No such team.");
  const label = teamHostLabel(team);
  return Response.redirect(`${platformOrigin(url, local)}/team-not-found?team=${label}`, 302);
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
  if (!local) return `https://${platformHost("")}`;
  return `${url.protocol}//${DEV_DOMAIN}${url.port ? `:${url.port}` : ""}`;
}

/** The team's home for a team address: <label>-<app>.<domain> → <label>.<domain>. */
function homeOf(url: URL, local: boolean): string {
  const [first, ...rest] = url.hostname.split(".");
  const label = first.split("-")[0];
  if (!local) return `https://${platformHost(label)}`;
  return `${url.protocol}//${[label, ...rest].join(".")}${url.port ? `:${url.port}` : ""}`;
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
  if (hostname === DEV_DOMAIN || hostname === "localhost") return platformHost("");
  if (hostname.endsWith(`.${DEV_DOMAIN}`)) {
    return platformHost(hostname.slice(0, -DEV_DOMAIN.length - 1));
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
  schedule: "schedule",
};

function devPage(request: Request, url: URL, app: Worker): Promise<Response> {
  const page = new URL(`${url.pathname}${url.search}`, devPorts.apps[DEV_APPS[app]].url);
  return fetch(new Request(page.toString(), request));
}

export default {
  async fetch(incoming: Request, env: Env): Promise<Response> {
    let request = incoming;
    const url = new URL(request.url);
    const localHost = env.LOCAL_DEV === "true" ? fromLocalHost(url.hostname) : null;
    const local = localHost !== null;
    const host = localHost ?? url.hostname;
    // Before routing, team/icon/session lookups, or any service-binding fetch.
    if (!local) {
      const limited = await checkRateLimit(request, env);
      if (limited) return limited;
    }
    const bodyChecked = await limitRequestBody(request);
    if (bodyChecked instanceof Response) return bodyChecked;
    request = bodyChecked;
    if (platformLabel(host) === DEMO_HOST_LABEL) {
      const home = teamAppUrlVia(local ? url.origin : undefined, demoTeamId, "portal");
      return Response.redirect(`${home}/`, 302);
    }
    const target = route(host);
    // Any other name on the platform's domain is nothing: the platform's not-found page.
    if (target === null && platformLabel(host) !== null) {
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

    let { team } = target;
    const isApiCall = url.pathname === "/api" || url.pathname.startsWith("/api/");
    let apps: OnApps = "all";
    if (team !== null) {
      const lookup = (id: string) => teamApps(id, () => loadTeamApps(env, id));
      let found: TeamApps;
      try {
        found = await lookup(team);
        // A team that moved: its pages go to its new address, its API calls on to it.
        if (found !== null && typeof found === "object" && "movedTo" in found) {
          if (!isApiCall) return movedPage(url, team, found.movedTo);
          team = found.movedTo;
          found = await lookup(team);
        }
      } catch (err) {
        console.error("[gateway] team lookup", err);
        return json(503, "Please try again in a minute.");
      }
      if (found === null || (typeof found === "object" && "movedTo" in found)) {
        return noSuchTeam(request, url, team, local);
      }
      // While it's moving only the platform's own API answers (the page that started the move).
      if (found === "moving") {
        const platformCall =
          target.app === "platform" || url.pathname.startsWith("/api/~platform/");
        if (!platformCall) return moving(request);
        apps = "all";
      } else apps = found;
    }
    if (!appEnabled(apps, target.app)) return notEnabled(request, target.app, homeOf(url, local));

    const isApi = isApiCall;
    // An installed app's icons, in the team's color (./icons.ts).
    if (team !== null && !isApi) {
      const original = (path: string) => {
        const file = new URL(path, url);
        const plain = new Request(file.toString(), { headers: { [IDENTITY_HEADERS.team]: team } });
        return local ? devPage(plain, file, target.app) : env[BINDINGS[target.app]].fetch(plain);
      };
      const icon = await teamIcon(request, url, team, env.G3ID, original);
      if (icon) return icon;
    }
    const headers = new Headers(request.headers);
    for (const name of Object.values(IDENTITY_HEADERS)) headers.delete(name);
    if (team !== null) headers.set(IDENTITY_HEADERS.team, team);

    if (isApi) {
      const origin = request.headers.get("Origin");
      if (origin && !originAllowed(origin, team, local)) {
        return json(
          403,
          isAllowedOrigin(origin, local)
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
      if (!appEnabled(apps, app)) return notEnabled(request, app, homeOf(url, local));
      url.pathname = `/api${other[2] ?? "/"}`;
    }
    if (url.pathname === "/api/internal" || url.pathname.startsWith("/api/internal/")) {
      return json(404, "Not found.");
    }
    if (isApi && team === demoTeamId) {
      const path = url.pathname.slice("/api".length) || "/";
      const refused = await checkDemoRequest(request, env, app, path, url.searchParams);
      if (refused) return refused;
    }
    return env[BINDINGS[app]].fetch(new Request(url.toString(), new Request(request, { headers })));
  },
};
