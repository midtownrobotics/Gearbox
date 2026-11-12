// SPDX-License-Identifier: AGPL-3.0-only
// License lint: Gearbox is AGPL-3.0-only (LICENSE). Every tracked source file starts with its
// SPDX line (after a shebang), and every package.json says the same license. Vendored code and
// built files keep their own. `--fix` adds the missing lines.
//
//   pnpm lint:license
//   pnpm lint:license --fix

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const LICENSE = "AGPL-3.0-only";
const TAG = `SPDX-License-Identifier: ${LICENSE}`;
const fix = process.argv.includes("--fix");

/** The header line for a file, by its extension; null for files that don't take one. */
function header(path: string): string | null {
  if (/\.(ts|tsx|mts|js|mjs|cjs)$/.test(path)) return `// ${TAG}`;
  if (path.endsWith(".css")) return `/* ${TAG} */`;
  if (/\.(sh|py)$/.test(path)) return `# ${TAG}`;
  return null;
}

/** Vendored code and built output, which keep their own license or none. */
const SKIP = [/^vendor\//, /^devices\/pit-log-downloader\/page\//, /\.d\.ts$/];

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const found: string[] = [];
for (const path of tracked) {
  if (SKIP.some((re) => re.test(path))) continue;

  if (path.endsWith("package.json")) {
    const full = join(root, path);
    const text = readFileSync(full, "utf8");
    const pkg = JSON.parse(text);
    if (pkg.license === LICENSE) continue;
    if (!fix) {
      found.push(`${path}: "license" should be "${LICENSE}"`);
      continue;
    }
    // Put "license" after "version" (or "name"), keeping the file's own formatting.
    const { license: _, ...rest } = pkg;
    const out: Record<string, unknown> = {};
    const after = "version" in rest ? "version" : "name";
    for (const [key, value] of Object.entries(rest)) {
      out[key] = value;
      if (key === after) out.license = LICENSE;
    }
    if (!("license" in out)) out.license = LICENSE;
    writeFileSync(full, `${JSON.stringify(out, null, 2)}\n`);
    continue;
  }

  const line = header(path);
  if (!line) continue;
  const full = join(root, path);
  const text = readFileSync(full, "utf8");
  const lines = text.split("\n");
  const at = lines[0]?.startsWith("#!") ? 1 : 0;
  if (lines[at] === line) continue;
  if (!fix) {
    found.push(`${path}: missing "${line}" on line ${at + 1}`);
    continue;
  }
  lines.splice(at, 0, line);
  writeFileSync(full, lines.join("\n"));
}

if (found.length > 0) {
  console.error(found.join("\n"));
  console.error(`\n${found.length} file(s) without the license. Run \`pnpm lint:license --fix\`.`);
  process.exit(1);
}
console.log(fix ? "License headers in place." : "Every file has its license.");
