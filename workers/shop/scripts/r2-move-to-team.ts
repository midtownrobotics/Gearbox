// One-off, for the Phase 3 deploy (migration 0016_teams.sql): copies the site team's files in R2
// from where they were before teams (drawings/..., part-files/...) to under its team prefix
// (teams/frc1648/...), where Shop now looks for them. Run it BEFORE applying the migration, which
// rewrites the keys stored in D1 to the new ones. It never deletes anything unless told to, and
// skips objects already copied, so it's safe to run again.
//
//   pnpm --filter @g3/worker-shop r2:move-to-team                 # production bucket, copy
//   pnpm --filter @g3/worker-shop r2:move-to-team -- --dry-run    # just say what it would copy
//   pnpm --filter @g3/worker-shop r2:move-to-team -- --local      # the local dev bucket
//   pnpm --filter @g3/worker-shop r2:move-to-team -- --delete-old # once Shop works: remove the
//                                                                 # old copies (only those copied)
//
// It reaches the bucket through Wrangler's platform proxy, so `wrangler login` is all it needs.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teamKey } from "@g3/site-config";
import { getPlatformProxy } from "wrangler";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const local = args.has("--local");
const deleteOld = args.has("--delete-old");
const BUCKET = "g3-bucket";
const OLD_PREFIXES = ["drawings/", "part-files/"];
const target = (key: string) => `teams/${teamKey}/${key}`;

// A config with just the bucket (remote unless --local), so nothing else is started.
const dir = mkdtempSync(join(tmpdir(), "shop-r2-"));
const configPath = join(dir, "wrangler.json");
writeFileSync(
  configPath,
  JSON.stringify({
    name: "shop-r2-move",
    compatibility_date: "2026-05-17",
    r2_buckets: [{ binding: "DRAWINGS", bucket_name: BUCKET, remote: !local }],
  }),
);

const proxy = await getPlatformProxy<{ DRAWINGS: R2Bucket }>({
  configPath,
  remoteBindings: !local,
  // The local bucket is the one `wrangler dev` uses in this worker's folder.
  persist: local ? { path: join(import.meta.dirname, "..", ".wrangler", "state", "v3") } : false,
});
const bucket = proxy.env.DRAWINGS;

let copied = 0;
let skipped = 0;
let deleted = 0;
try {
  for (const prefix of OLD_PREFIXES) {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({
        prefix,
        cursor,
        include: ["httpMetadata", "customMetadata"],
      });
      for (const object of page.objects) {
        const to = target(object.key);
        const already = await bucket.head(to);
        if (deleteOld) {
          // Only remove an old object once its copy is there, the same size.
          if (already && already.size === object.size) {
            if (!dryRun) await bucket.delete(object.key);
            deleted++;
            console.log(`${dryRun ? "would delete" : "deleted"} ${object.key}`);
          } else {
            console.warn(`kept ${object.key}: no copy at ${to} yet`);
          }
          continue;
        }
        if (already) {
          skipped++;
          continue;
        }
        console.log(`${dryRun ? "would copy" : "copy"} ${object.key} -> ${to}`);
        if (!dryRun) {
          const body = await bucket.get(object.key);
          if (!body) continue;
          await bucket.put(to, await body.arrayBuffer(), {
            httpMetadata: object.httpMetadata,
            customMetadata: object.customMetadata,
          });
        }
        copied++;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
} finally {
  await proxy.dispose();
  rmSync(dir, { recursive: true, force: true });
}

console.log(
  deleteOld
    ? `${dryRun ? "Would delete" : "Deleted"} ${deleted} old object(s).`
    : `${dryRun ? "Would copy" : "Copied"} ${copied} object(s) to teams/${teamKey}/; ${skipped} were already there.`,
);
