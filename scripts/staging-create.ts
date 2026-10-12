// `pnpm staging:create`: makes what staging (roadmap 0.2) needs on Cloudflare, once. Safe to run
// again: it only makes what's missing.
// - a D1 database, KV namespace, R2 bucket and queue for each one in the workers' [env.staging]
//   (written by `pnpm configure`), and the databases' and namespaces' ids in
//   infra/staging/resources.json, then runs `pnpm configure` to put them in each wrangler.toml;
// - an empty placeholder Worker for each staging Worker that doesn't exist yet. Workers bind to
//   each other (G3ID and the platform both ways), and a Worker can't be deployed while one it
//   binds to is missing; the first real deploy replaces them.
// Needs a Wrangler login (`wrangler login`) or CLOUDFLARE_API_TOKEN, and CLOUDFLARE_ACCOUNT_ID if
// the login sees several accounts: Wrangler runs non-interactively here, so it can't ask. Pass
// --dry-run to only print what it would do.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const MARK = "# ---- Staging:";

/** Wrangler as a worker installs it. */
const WRANGLER = join(root, "workers/g3id/node_modules/.bin/wrangler");

/** An empty folder to run Wrangler in, so no worker's wrangler.toml applies. */
const scratch = mkdtempSync(join(tmpdir(), "gearbox-staging-"));

/**
 * Runs Wrangler and gives back what it printed. Its messages reach the terminal, unless `quiet`
 * (for an answer that's expected to fail).
 */
function wrangler(args: string[], { quiet = false } = {}): string {
  skipUpdateCheck();
  try {
    return execFileSync(WRANGLER, args, {
      cwd: scratch,
      encoding: "utf8",
      env: WRANGLER_ENV,
      stdio: ["ignore", "pipe", quiet ? "pipe" : "inherit"],
      timeout: TIMEOUT_MS,
    });
  } catch (err) {
    if ((err as { code?: string }).code === "ETIMEDOUT") {
      throw new Error(`wrangler ${args.join(" ")} didn't finish in ${TIMEOUT_MS / 1000} s.`);
    }
    throw err;
  }
}

/**
 * Wrangler checks npm for a newer version of itself (on its banner, and again after an error),
 * and on a slow link to npm that download (megabytes) keeps it from exiting for minutes after it's
 * done. The check skips npm while its cache (update-check's, in the temp folder) is under an hour
 * old, so this says it just checked.
 */
function skipUpdateCheck() {
  const dir = join(tmpdir(), "update-check");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "wrangler-latest.json"),
    JSON.stringify({ latest: WRANGLER_VERSION, lastUpdate: Date.now() }),
  );
}
const WRANGLER_VERSION = (
  JSON.parse(
    readFileSync(join(root, "workers/g3id/node_modules/wrangler/package.json"), "utf8"),
  ) as {
    version: string;
  }
).version;

/**
 * Never interactive: what this script reads back is Wrangler's output, so a question it asked
 * there (usage metrics, which account) would wait unseen. Logged in already, or a token. No
 * banner either: printing it checks npm for a newer Wrangler, and on a slow link to npm that
 * download (megabytes) keeps Wrangler from exiting for minutes after it's done.
 */
const WRANGLER_ENV = {
  ...process.env,
  CI: "1",
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_HIDE_BANNER: "true",
};
const TIMEOUT_MS = 120_000;

// Signed in, and to which account: before anything else. Straight to the terminal.
console.log("Checking the Wrangler login…");
execFileSync(WRANGLER, ["whoami"], {
  cwd: scratch,
  env: WRANGLER_ENV,
  stdio: "inherit",
  timeout: TIMEOUT_MS,
});

/** Makes something, unless dry-running; "already exists" counts as made. */
function make(what: string, args: string[]) {
  if (dryRun) return console.log(`would make ${what}`);
  console.log(`making ${what}…`);
  try {
    wrangler(args, { quiet: true });
  } catch (err) {
    const text = String((err as { stderr?: string }).stderr ?? err);
    if (/already exists|already taken|already owned/i.test(text)) return;
    console.error(text);
    throw err;
  }
}

// What the staging parts of the wrangler.toml files name.
const names = { workers: new Set<string>(), d1: new Set<string>(), kv: new Set<string>() };
const buckets = new Set<string>();
const queues = new Set<string>();
for (const dir of readdirSync(join(root, "workers"))) {
  let text: string;
  try {
    text = readFileSync(join(root, "workers", dir, "wrangler.toml"), "utf8");
  } catch {
    continue;
  }
  if (!text.includes(MARK)) continue;
  const staging = text.slice(text.indexOf(MARK));
  const all = (re: RegExp) => [...staging.matchAll(re)].map((m) => m[1]);
  for (const name of all(/^\[env\.staging\]\nname = "([^"]+)"/gm)) names.workers.add(name);
  for (const name of all(/^database_name = "([^"]+)"/gm)) names.d1.add(name);
  for (const binding of all(/^\[\[env\.staging\.kv_namespaces\]\]\nbinding = "([^"]+)"/gm)) {
    names.kv.add(binding);
  }
  for (const name of all(/^bucket_name = "([^"]+)"/gm)) buckets.add(name);
  for (const name of all(/^queue = "([^"]+)"/gm)) queues.add(name);
}

const resourcesPath = join(root, "infra/staging/resources.json");
const resources = JSON.parse(readFileSync(resourcesPath, "utf8")) as {
  d1: Record<string, string>;
  kv: Record<string, string>;
};

// D1 databases.
const listD1 = () =>
  JSON.parse(wrangler(["d1", "list", "--json"])) as {
    uuid: string;
    name: string;
  }[];
let d1 = listD1();
for (const name of names.d1) {
  if (!d1.some((db) => db.name === name)) make(`D1 database ${name}`, ["d1", "create", name]);
}
if (!dryRun) d1 = listD1();
for (const name of names.d1) {
  const id = d1.find((db) => db.name === name)?.uuid;
  if (id) resources.d1[name] = id;
}

// KV namespaces, one per binding (Sessions is shared by G3ID, Shop and Pit, like production's).
const kvTitle = (binding: string) => `gearbox-staging-${binding}`;
const listKv = () =>
  JSON.parse(wrangler(["kv", "namespace", "list"])) as {
    id: string;
    title: string;
  }[];
let kv = listKv();
for (const binding of names.kv) {
  if (!kv.some((ns) => ns.title === kvTitle(binding))) {
    make(`KV namespace ${kvTitle(binding)}`, ["kv", "namespace", "create", kvTitle(binding)]);
  }
}
if (!dryRun) kv = listKv();
for (const binding of names.kv) {
  const id = kv.find((ns) => ns.title === kvTitle(binding))?.id;
  if (id) resources.kv[binding] = id;
}

// R2 buckets and queues.
for (const bucket of buckets) make(`R2 bucket ${bucket}`, ["r2", "bucket", "create", bucket]);
for (const queue of queues) make(`queue ${queue}`, ["queues", "create", queue]);

if (!dryRun) {
  writeFileSync(resourcesPath, `${JSON.stringify(resources, null, 2)}\n`);
  execFileSync("node", ["scripts/configure.ts"], { cwd: root, stdio: "inherit" });
}

// Placeholder Workers for the staging Workers that don't exist yet.
console.log("Checking which staging Workers exist…");
const stub = join(scratch, "placeholder.js");
writeFileSync(
  stub,
  'export default { fetch: () => new Response("Not deployed yet.", { status: 503 }) };\n',
);
for (const name of names.workers) {
  try {
    wrangler(["deployments", "list", "--name", name], { quiet: true });
    continue;
  } catch {
    // Doesn't exist yet.
  }
  if (dryRun) {
    console.log(`would make placeholder Worker ${name}`);
    continue;
  }
  console.log(`making placeholder Worker ${name}…`);
  // Straight to the terminal, as if typed there: run with its output captured and
  // non-interactively, this deploy waited on Cloudflare and never finished.
  skipUpdateCheck();
  execFileSync(
    WRANGLER,
    [
      "deploy",
      "placeholder.js",
      "--name",
      name,
      "--compatibility-date",
      "2026-05-17",
      "--no-bundle",
    ],
    {
      cwd: scratch,
      env: { ...process.env, WRANGLER_HIDE_BANNER: "true" },
      stdio: "inherit",
      timeout: TIMEOUT_MS,
    },
  );
}

console.log(dryRun ? "Dry run: nothing was made." : "Staging's resources are ready.");
