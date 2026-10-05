import {
  type AppName,
  CONSOLE_HOSTS,
  TEAM_HOST_APPS,
  isAllowedOrigin,
  site,
  teamKey,
} from "@g3/site-config";

// The one worker on *.<domain>/* and the platform's domain: works out the team and app from the
// hostname and sends the request to that app's worker. Each app's worker serves the app's page and
// its API at /api (see @g3/site-config/worker). <domain> is site.ts's `domain` (the team in site.ts,
// G3 today) and <platform> its `platformDomain` (every other team, and the platform itself).
//   <app>.<domain>/...             → the app, for the team in site.ts
//   api.<app>.<domain>/...         → the app's /api/..., for the team in site.ts (the older API
//                                    addresses, which Slack, webhooks and the edge box may still use)
//   <platform>/, www.<platform>/   → the platform worker: public site and team sign-up
//   admin.<domain>/, admin.<platform>/ → the platform worker: the operators' console (on both
//                                    domains, so it gets an operator's session cookie on either)
//   <number>.<platform>/...        → that team's home (Portal)
//   <number>-<app>.<platform>/...  → the app, for team <number>
//   <any of those>/api/~<app>/...  → another app's /api/..., for the same team: how one app's page
//                                    calls another's API (`apiPath` in @g3/site-config)
//   id.<domain>/, id.<platform>/   → G3ID, for no team: where sign-in providers call back
//                                    (`signInCallbackApiUrl`); the team is in the sign-in's state
//   anything else                  → passed on to wherever its DNS points (www, the edge box's tunnel)
// /api/internal/... is for workers only (over service bindings) and never answered here.
//
// On the way it keeps teams apart (roadmap step 2.3):
// - A team-number host only answers for a team the platform has (signed up and active).
// - A session belonging to another team's member is dropped: the app sees a signed-out request.
// - An /api request from another team's page (its Origin) is refused. Every app's CORS allows the
//   whole domain, so without this one team's page could call another team's API with a member's
//   cookie.
// - The app gets the team and the signed-in user as headers (IDENTITY_HEADERS); copies a client
//   sent are removed first. Apps don't rely on them yet; production app workers have no
//   workers.dev address, so these headers can only come from here.

/** An app, or the platform itself. */
type Worker = AppName | "platform";

export type Env = Record<(typeof BINDINGS)[Worker], Fetcher>;

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
type Route = { app: Worker; team: string | null; oldApi: boolean };

/** Platform hosts: the same for every team. */
const PLATFORM_ROUTES = new Map<string, Route>([
  [site.platformDomain, { app: "platform", team: null, oldApi: false }],
  [`www.${site.platformDomain}`, { app: "platform", team: null, oldApi: false }],
  ...CONSOLE_HOSTS.map((host): [string, Route] => [
    host,
    { app: "platform", team: null, oldApi: false },
  ]),
  [`id.${site.domain}`, { app: "id", team: null, oldApi: false }],
  [`id.${site.platformDomain}`, { app: "id", team: null, oldApi: false }],
]);

/** The hostnames for the team in site.ts: each app's address, and its older API address. */
const SITE_ROUTES = new Map<string, Route>(
  (Object.keys(site.apps) as AppName[]).flatMap((app) => {
    const { web, api } = site.apps[app];
    const routes: [string, Route][] = [
      [`${web}.${site.domain}`, { app, team: teamKey, oldApi: false }],
    ];
    if (api) routes.push([`${api}.${site.domain}`, { app, team: teamKey, oldApi: true }]);
    return routes;
  }),
);

const TEAM_HOST_APP = new Map<string, AppName>(
  Object.entries(TEAM_HOST_APPS).map(([app, host]) => [host, app as AppName]),
);

/**
 * The app and team a hostname is for; "unknown app" for a team host naming no app; null for a
 * hostname that isn't an app at all.
 */
export function route(hostname: string): Route | "unknown app" | null {
  const known = SITE_ROUTES.get(hostname) ?? PLATFORM_ROUTES.get(hostname);
  if (known) return known;
  if (!hostname.endsWith(`.${site.platformDomain}`)) return null;
  const label = hostname.slice(0, -site.platformDomain.length - 1);
  const match = label.match(/^([1-9]\d*)(?:-(.+))?$/);
  if (!match) return null;
  const app = match[2] === undefined ? "portal" : TEAM_HOST_APP.get(match[2]);
  if (!app) return "unknown app";
  return { app, team: `frc${match[1]}`, oldApi: false };
}

/**
 * Whether a page at `origin` may call a team's API: one of the team's own pages, or a page of no
 * team (www, the platform's hosts, localhost). A platform host's API takes any of the domain's.
 */
function originAllowed(origin: string, team: string | null): boolean {
  if (!isAllowedOrigin(origin)) return false;
  const from = route(new URL(origin).hostname);
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

const teamExists = memo<boolean>();
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const target = route(url.hostname);
    if (target === null) {
      // Not an app: let the request go where its DNS record points (a worker's own route doesn't
      // run again for its subrequests). If nothing is behind it, Cloudflare answers with an error.
      try {
        return await fetch(request);
      } catch {
        return new Response("Nothing is here.", { status: 502 });
      }
    }
    if (target === "unknown app") return json(404, "No such app.");

    const insecure = toHttps(url);
    if (insecure) return insecure;

    const { team } = target;
    if (team !== null && team !== teamKey) {
      const exists = await teamExists(team, async () => {
        const res = await env.PLATFORM.fetch(`http://platform/api/teams/${team}`);
        return res.ok;
      });
      if (!exists) return json(404, "No such team.");
    }

    const isApi = target.oldApi || url.pathname === "/api" || url.pathname.startsWith("/api/");
    const headers = new Headers(request.headers);
    for (const name of Object.values(IDENTITY_HEADERS)) headers.delete(name);
    if (team !== null) headers.set(IDENTITY_HEADERS.team, team);

    if (isApi) {
      const origin = request.headers.get("Origin");
      if (origin && !originAllowed(origin, team)) {
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

    let app: Worker = target.app;
    const other = target.oldApi ? null : url.pathname.match(/^\/api\/~([A-Za-z]+)(\/.*)?$/);
    if (other) {
      if (!(other[1] in BINDINGS)) return json(404, "No such app.");
      app = other[1] as Worker;
      url.pathname = `/api${other[2] ?? "/"}`;
    }
    if (target.oldApi) url.pathname = `/api${url.pathname}`;
    if (url.pathname === "/api/internal" || url.pathname.startsWith("/api/internal/")) {
      return json(404, "Not found.");
    }
    return env[BINDINGS[app]].fetch(new Request(url.toString(), new Request(request, { headers })));
  },
};
