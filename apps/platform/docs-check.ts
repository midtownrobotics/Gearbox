import { buildDocs } from "./docs-plugin.ts";

// `pnpm --filter @g3/platform test`: the docs build, with no broken links.
const { pages, problems } = buildDocs();
if (problems.length > 0) {
  console.error(`Docs have broken links:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Docs: ${pages.length} pages, no broken links.`);
