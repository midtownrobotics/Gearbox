import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { type AppName, allAppsUrl, apiPath, appUrl, idName, site } from "./index.ts";

/** Each app's worker in .dev-ports.json (Portal has none). */
const DEV_WORKERS: Partial<Record<AppName, string>> = {
  id: "g3id",
  shop: "shop",
  pit: "pit",
  orders: "orders",
  edge: "edge",
  scouting: "scouting",
  skillTree: "skill-tree",
  attendance: "attendance",
};

/**
 * Brings site.ts into an app's build:
 * - fills %SITE_SHORT_NAME% ("G3"), %SITE_TEAM_NAME% ("G3 Robotics"), %SITE_TEAM_NUMBER%
 *   ("1648"), %SITE_DOMAIN%, %SITE_ID_NAME% ("G3ID"), %SITE_ALL_APPS_URL% and, given `app`,
 *   %SITE_APP_URL% (its own address) in index.html;
 * - sets `productionEnv` (e.g. VITE_API_BASE_URL: apiUrl("orders")) for production builds, so the
 *   URLs come from site.ts instead of a .env.production file. .env.development still applies in
 *   dev, and a real environment variable still wins;
 * - defines the app's version (its package.json) and the platform version (the repo root's) for
 *   `@g3/site-config/versions`;
 * - in dev, proxies `apiPath(app)` (/api/~<app>) to each app's local worker, as the gateway does in
 *   production.
 */
export function siteConfig(
  options: { app?: AppName; productionEnv?: Record<string, string> } = {},
): Plugin {
  const values: Record<string, string> = {
    SITE_SHORT_NAME: site.team.shortName,
    SITE_TEAM_NAME: site.team.name,
    SITE_TEAM_NUMBER: String(site.team.number),
    SITE_DOMAIN: site.domain,
    SITE_ID_NAME: idName,
    SITE_ALL_APPS_URL: allAppsUrl,
    ...(options.app ? { SITE_APP_URL: appUrl(options.app) } : {}),
  };
  return {
    name: "g3-site-config",
    config(config, { mode }) {
      const appDir = config.root ?? process.cwd();
      const readVersion = (dir: string) =>
        (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string })
          .version;
      const define = {
        __G3_APP_VERSION__: JSON.stringify(readVersion(appDir)),
        __G3_PLATFORM_VERSION__: JSON.stringify(readVersion(join(import.meta.dirname, "../../.."))),
      };
      if (mode !== "production") {
        const root = join(import.meta.dirname, "../../..");
        const ports = JSON.parse(readFileSync(join(root, ".dev-ports.json"), "utf8")) as {
          workers: Record<string, { port: number }>;
        };
        const proxies = Object.fromEntries(
          Object.entries(DEV_WORKERS).map(([app, worker]) => {
            const prefix = apiPath(app as AppName);
            return [
              prefix,
              {
                target: `http://localhost:${ports.workers[worker].port}`,
                rewrite: (path: string) => path.slice(prefix.length) || "/",
              },
            ];
          }),
        );
        // Ahead of the app's own /api proxy, which would otherwise match first.
        config.server ??= {};
        config.server.proxy = { ...proxies, ...config.server.proxy };
        return { define };
      }
      // Vite reads VITE_* from the process environment, ahead of .env files.
      for (const [key, value] of Object.entries(options.productionEnv ?? {})) {
        process.env[key] ??= value;
      }
      return { define };
    },
    transformIndexHtml: (html) =>
      html.replace(/%(SITE_[A-Z_]+)%/g, (token, key: string) => values[key] ?? token),
  };
}
