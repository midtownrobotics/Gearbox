import { type AppName, site } from "@g3/site-config";

// The one worker on *.<domain>/*: sends each request to its app's worker by hostname. Each app's
// worker serves the app's page and its API at /api (see @g3/site-config/worker).
//   <app>.<domain>/...        → the app's worker, unchanged
//   api.<app>.<domain>/...    → the app's worker at /api/... (the older API addresses, which
//                               sign-in callbacks, Slack, webhooks and the edge box may still use)
//   anything else             → passed on to wherever its DNS points (www, the edge box's tunnel)

export type Env = Record<(typeof BINDINGS)[AppName], Fetcher>;

/** The service binding for each app's worker (wrangler.toml). */
const BINDINGS = {
  id: "G3ID",
  portal: "PORTAL",
  shop: "SHOP",
  pit: "PIT",
  orders: "ORDERS",
  edge: "EDGE",
  scouting: "SCOUTING",
  skillTree: "SKILL_TREE",
  attendance: "ATTENDANCE",
} as const satisfies Record<AppName, string>;

type Route = { app: AppName; oldApi: boolean };

/** Every hostname the gateway answers, from site.ts. */
export const ROUTES = new Map<string, Route>(
  (Object.keys(site.apps) as AppName[]).flatMap((app) => {
    const { web, api } = site.apps[app];
    const routes: [string, Route][] = [[`${web}.${site.domain}`, { app, oldApi: false }]];
    if (api) routes.push([`${api}.${site.domain}`, { app, oldApi: true }]);
    return routes;
  }),
);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = ROUTES.get(url.hostname);
    if (!route) {
      // Not an app: let the request go where its DNS record points (a worker's own route doesn't
      // run again for its subrequests). If nothing is behind it, Cloudflare answers with an error.
      try {
        return await fetch(request);
      } catch {
        return new Response("Nothing is here.", { status: 502 });
      }
    }
    const worker = env[BINDINGS[route.app]];
    if (!route.oldApi) return worker.fetch(request);
    url.pathname = `/api${url.pathname}`;
    return worker.fetch(new Request(url, request));
  },
};
