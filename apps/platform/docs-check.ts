import { buildDocs } from "./docs-plugin.ts";

// `pnpm --filter @g3/platform test`: the docs build, with no broken links, and every page's
// `pages:` naming routes its app has.
const { pages, problems } = buildDocs();
if (problems.length > 0) {
  console.error(`Docs have problems:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Docs: ${pages.length} pages, no broken links or unknown pages.`);
