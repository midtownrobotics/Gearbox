import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Plugin } from "vite";
import { type HelpPages, docsFrontMatter, pagePaths } from "./help.ts";
import { type AppName, apiPath } from "./index.ts";

/** Each app's worker in .dev-ports.json (Portal has none), and the platform's. */
const DEV_WORKERS: Partial<Record<AppName | "platform", string>> = {
  platform: "platform",
  id: "g3id",
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

/**
 * "Need help?" for the app in `appDir`: each route path its docs name (`pages:` in each
 * `docs/*.md`), with the doc's slug (./help.ts). Null when it has no docs folder. The docs build
 * checks the paths; this only reads them.
 */
function readHelpPages(appDir: string): HelpPages | null {
  const dir = join(appDir, "docs");
  if (!existsSync(join(dir, "index.md"))) return null;
  const folder = basename(appDir);
  const pages: HelpPages["pages"] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "index.md")) {
    const { fields } = docsFrontMatter(readFileSync(join(dir, name), "utf8"), name);
    for (const path of pagePaths(fields.pages)) pages.push([path, name.slice(0, -3)]);
  }
  return { section: folder === "platform" ? "start" : folder, pages };
}

/** A git command's output in `dir`, or "" when git isn't there or fails. */
function git(dir: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

/**
 * The pull request a staging build was made from, read off the commit it's built from: GitHub's
 * merge commit ("Merge pull request #284 from …") or squash commit ("Title (#284)"). Its repository
 * is GitHub Actions' GITHUB_REPOSITORY, else the origin remote's. Null when it can't tell.
 */
function lastPullRequest(root: string): { number: string; url: string } | null {
  const subject = git(root, "log", "-1", "--format=%s");
  const number =
    subject.match(/^Merge pull request #(\d+)\b/)?.[1] ?? subject.match(/\(#(\d+)\)$/)?.[1];
  const repo =
    process.env.GITHUB_REPOSITORY ??
    git(root, "remote", "get-url", "origin").match(
      /github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/,
    )?.[1];
  if (!number || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return { number, url: `https://github.com/${repo}/pull/${number}` };
}

/**
 * Brings site.ts into an app's build. Nothing team-specific is built in (roadmap 2.10): a page
 * learns its team from its address and its names from the team's appearance settings at runtime,
 * so one build serves every team. This:
 * - sets `productionEnv` (e.g. VITE_API_BASE_URL: apiUrl("orders")) for production builds, so the
 *   URLs come from site.ts instead of a .env.production file. .env.development still applies in
 *   dev, and a real environment variable still wins;
 * - defines the app's version (its package.json) and the platform version (the repo root's) for
 *   `@g3/site-config/versions`;
 * - defines the pages its docs are about (`readHelpPages`), for the bar's "Need help?" (`helpUrl`);
 * - in dev, proxies `apiPath(app)` (/api/~<app>) to each app's local worker, as the gateway does in
 *   production;
 * - in dev, points site-config's addresses (`appUrl`, `teamAppUrl`, `allAppsUrl`, ...) at the
 *   local dev gateway (`localGateway`), so links stay on your machine;
 * - with GEARBOX_STAGING=1 (each worker's [env.staging.build]), makes a staging build: its
 *   addresses are staging's (`isStaging`), and every page has a "Staging" banner, with a link to
 *   the pull request last merged into the branch it was built from (`lastPullRequest`).
 */
export function siteConfig(
  options: { app?: AppName; productionEnv?: Record<string, string> } = {},
): Plugin {
  const root = join(import.meta.dirname, "../../..");
  const devPorts = () =>
    JSON.parse(readFileSync(join(root, ".dev-ports.json"), "utf8")) as {
      workers: Record<string, { port: number; url: string }>;
    };
  const staging = () => process.env.GEARBOX_STAGING === "1";
  /** The banner's text: the pull request is the only part that takes clicks. */
  const banner = () => {
    const pr = lastPullRequest(root);
    return pr
      ? `Staging: not the real apps · <a href="${pr.url}" target="_blank" rel="noreferrer" style="color:inherit;text-decoration:underline;pointer-events:auto">#${pr.number}</a>`
      : "Staging: not the real apps";
  };
  return {
    name: "g3-site-config",
    // Staging: a banner on every page, so nobody mistakes it for the real apps. Amber for a
    // warning; fixed at the bottom, clear of each app's sticky top bar.
    transformIndexHtml: {
      order: "post",
      handler: (html, ctx) =>
        staging() && !ctx.server
          ? [
              {
                tag: "div",
                attrs: {
                  role: "note",
                  style:
                    "position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:4px 12px;border-radius:999px;background:#f59e0b;color:#1f1300;font:600 12px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgb(0 0 0 / .25);pointer-events:none",
                },
                children: banner(),
                injectTo: "body",
              },
            ]
          : html,
    },
    // "Need help?" is read from the app's docs when Vite starts: a change to them restarts it, so
    // a new or changed `pages:` line works without restarting `pnpm dev` by hand.
    configureServer(server) {
      const docs = join(server.config.root, "docs");
      if (!existsSync(docs)) return;
      server.watcher.add(docs);
      const restart = (file: string) => {
        if (file.startsWith(docs) && file.endsWith(".md")) void server.restart();
      };
      server.watcher.on("change", restart);
      server.watcher.on("add", restart);
      server.watcher.on("unlink", restart);
    },
    config(config, { mode }) {
      const appDir = config.root ?? process.cwd();
      const readVersion = (dir: string) =>
        (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string })
          .version;
      const define = {
        __G3_APP_VERSION__: JSON.stringify(readVersion(appDir)),
        __G3_PLATFORM_VERSION__: JSON.stringify(readVersion(join(import.meta.dirname, "../../.."))),
        __G3_HELP__: JSON.stringify(readHelpPages(appDir)),
      };
      if (mode !== "production") {
        const ports = devPorts();
        const gateway = ports.workers.gateway?.url;
        if (gateway) Object.assign(define, { __G3_LOCAL_GATEWAY__: JSON.stringify(gateway) });
        const proxies = Object.fromEntries(
          Object.entries(DEV_WORKERS).map(([app, worker]) => {
            const prefix = apiPath(app as AppName | "platform");
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
      if (staging()) Object.assign(define, { __G3_STAGING__: "true" });
      // Vite reads VITE_* from the process environment, ahead of .env files.
      for (const [key, value] of Object.entries(options.productionEnv ?? {})) {
        process.env[key] ??= value;
      }
      return { define };
    },
  };
}
