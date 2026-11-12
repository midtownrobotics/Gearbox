// SPDX-License-Identifier: AGPL-3.0-only
// `pnpm db:migrate:local`: applies every worker's D1 migrations to its local database (the one
// `pnpm dev` uses), one worker at a time. Through ./lib/wrangler.ts, so Wrangler's npm check
// can't keep it from exiting, and non-interactively, so it never waits on "Ok to proceed?".
// Works while `pnpm dev` is running.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { root, wranglerOutput } from "./lib/wrangler.ts";

const workers = join(root, "workers");
let failed = 0;
for (const name of readdirSync(workers).sort()) {
  let script: string | undefined;
  try {
    const pkg = JSON.parse(readFileSync(join(workers, name, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    script = pkg.scripts?.["db:migrate:local"];
  } catch {
    continue;
  }
  // "wrangler d1 migrations apply <BINDING> --local"
  const binding = script?.match(/migrations apply (\S+) --local/)?.[1];
  if (!binding) continue;
  process.stdout.write(`${name} (${binding}): `);
  try {
    const out = wranglerOutput(["d1", "migrations", "apply", binding, "--local"], {
      cwd: join(workers, name),
      quiet: true,
    });
    // Wrangler draws its table again as each one finishes: each name once.
    const applied = [
      ...new Set([...out.matchAll(/(\d{4}_[\w-]+\.sql)\s*│\s*✅/g)].map((m) => m[1])),
    ];
    console.log(applied.length ? `applied ${applied.join(", ")}` : "up to date");
  } catch (err) {
    failed++;
    console.log("failed");
    console.error((err as { stderr?: string }).stderr || (err as Error).message);
  }
}
process.exit(failed ? 1 : 0);
