import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { type AppName, apiPath } from "./index.ts";

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
 * Brings site.ts into an app's build. Nothing team-specific is built in (roadmap 2.10): a page
 * learns its team from its address and its names from the team's appearance settings at runtime,
 * so one build serves every team. This:
 * - sets `productionEnv` (e.g. VITE_API_BASE_URL: apiUrl("orders")) for production builds, so the
 *   URLs come from site.ts instead of a .env.production file. .env.development still applies in
 *   dev, and a real environment variable still wins;
 * - defines the app's version (its package.json) and the platform version (the repo root's) for
 *   `@g3/site-config/versions`;
 * - in dev, proxies `apiPath(app)` (/api/~<app>) to each app's local worker, as the gateway does in
 *   production;
 * - in dev, points site-config's addresses (`appUrl`, `teamAppUrl`, `allAppsUrl`, ...) at the
 *   local dev gateway (`localGateway`), so links stay on your machine.
 */
export function siteConfig(
  options: { app?: AppName; productionEnv?: Record<string, string> } = {},
): Plugin {
  const root = join(import.meta.dirname, "../../..");
  const devPorts = () =>
    JSON.parse(readFileSync(join(root, ".dev-ports.json"), "utf8")) as {
      workers: Record<string, { port: number; url: string }>;
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
        const ports = devPorts();
        const gateway = ports.workers.gateway?.url;
        if (gateway) Object.assign(define, { __G3_LOCAL_GATEWAY__: JSON.stringify(gateway) });
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
  };
}
