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
// A query that must read every team's rows (a cron job finding which teams to work on) goes on the
// line after a `// tenancy: all teams (<why>)` comment, which a reviewer can see and question.
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
  {
    dir: "workers/attendance",
    teamTables: {
      attendanceMembers: "attendance_members",
      attendanceSessions: "attendance_sessions",
      attendanceTotals: "attendance_totals",
      attendanceSettings: "attendance_settings",
    },
  },
  {
    dir: "workers/inventory",
    teamTables: {
      fields: "fields",
      locations: "locations",
      robots: "robots",
      subsystems: "subsystems",
      items: "items",
      itemListings: "item_listings",
      stock: "stock",
      itemEvents: "item_events",
      intakeReceipts: "intake_receipts",
    },
  },
];

/** The literal SQL a `sql` template writes: its text, not the `${…}` values put in. */
function templateText(template: ts.TemplateLiteral) {
  if (ts.isNoSubstitutionTemplateLiteral(template)) return template.text;
  return [template.head.text, ...template.templateSpans.map((span) => span.literal.text)].join(" ");
}

/** A `// tenancy: all teams (…)` comment on one of the few lines above the node's statement. */
function allTeamsAllowed(text: string, line: number) {
  const lines = text.split("\n");
  return lines
    .slice(Math.max(0, line - 3), line)
    .some((l) => /\/\/\s*tenancy: all teams \(.+\)/.test(l));
}

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
  const sqlNames = Object.values(app.teamTables);
  for (const file of sourceFiles(join(root, app.dir, "src"))) {
    const text = readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    // A table's alias (`const s = alias(stock, "s")`) is the team table under another name.
    const tables: Record<string, string> = { ...app.teamTables };
    const findAliases = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === "alias"
      ) {
        const [of] = node.initializer.arguments;
        if (of && ts.isIdentifier(of) && of.text in app.teamTables) {
          tables[node.name.text] = app.teamTables[of.text];
        }
      }
      ts.forEachChild(node, findAliases);
    };
    findAliases(source);
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
          const chain = chainOf(node);
          const statement = chain.getText(source);
          const { line } = source.getLineAndCharacterOfPosition(chain.getStart());
          if (allTeamsAllowed(text, line)) return ts.forEachChild(node, visit);
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
        const template = templateText(node.template);
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
