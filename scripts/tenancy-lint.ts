// Tenancy lint (roadmap Phase 3): in every app that serves many teams, a query on a team's table
// must go through the team-scoped helpers in @g3/auth (`inTeam`, `withTeam`),
// so a forgotten team filter fails CI instead of showing one team another team's rows.
//
//   pnpm lint:tenancy
//
// For each app below it reports:
//   - a raw D1 `.prepare(` call (queries go through Drizzle and the helpers);
//   - a Drizzle `from`/`update`/`delete`/join on a team table whose statement has no `inTeam(`,
//     or an `insert` into one with no `withTeam(`;
//   - a `sql` template that names a team table.
// An app joins this list when its Phase 3 pull request makes it team-scoped.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

type App = {
  dir: string;
  /** The Drizzle table variables that hold a team's rows, and their SQL names. */
  teamTables: Record<string, string>;
};

const APPS: App[] = [
  // Every other table hangs off the team's tree set and is reached by the set's id.
  { dir: "workers/skill-tree", teamTables: { treeSets: "tree_sets" } },
];

const SCOPED = new Set(["from", "update", "delete", "innerJoin", "leftJoin", "rightJoin"]);
const root = new URL("..", import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

/** The whole statement a call is part of: up through the chain it's in. */
function chainOf(node: ts.Node): ts.Node {
  let current = node;
  while (
    current.parent &&
    (ts.isPropertyAccessExpression(current.parent) ||
      (ts.isCallExpression(current.parent) && current.parent.expression === current) ||
      ts.isAwaitExpression(current.parent))
  ) {
    current = current.parent;
  }
  return current;
}

const problems: string[] = [];

for (const app of APPS) {
  const tables = app.teamTables;
  const sqlNames = Object.values(tables);
  for (const file of sourceFiles(join(root, app.dir, "src"))) {
    const text = readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const at = (node: ts.Node) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      return `${relative(root, file)}:${line + 1}`;
    };

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const [first] = node.arguments;
        if (method === "prepare") {
          problems.push(`${at(node)}: raw D1 query; use Drizzle with inTeam/withTeam`);
        } else if (first && ts.isIdentifier(first) && first.text in tables) {
          const statement = chainOf(node).getText(source);
          if (method === "insert" && !statement.includes("withTeam(")) {
            problems.push(`${at(node)}: insert into ${first.text} without withTeam()`);
          } else if (SCOPED.has(method) && !statement.includes("inTeam(")) {
            problems.push(`${at(node)}: ${method}(${first.text}) without inTeam()`);
          }
        }
      }
      if (
        ts.isTaggedTemplateExpression(node) &&
        ts.isIdentifier(node.tag) &&
        node.tag.text === "sql"
      ) {
        const template = node.template.getText(source);
        for (const name of sqlNames) {
          if (new RegExp(`\\b${name}\\b`).test(template)) {
            problems.push(`${at(node)}: raw SQL on team table ${name}; use Drizzle with inTeam`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

if (problems.length > 0) {
  console.error(`Tenancy lint: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`Tenancy lint: ${APPS.map((a) => a.dir).join(", ")} keep every team table scoped.`);
