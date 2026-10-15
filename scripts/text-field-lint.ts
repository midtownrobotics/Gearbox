// Text field lint (roadmap 5.7): every app's text boxes are @g3/ui's TextField, so the public demo
// can offer safe text to pick in each of them instead of typing (see TextField). It fails on a
// plain `<textarea>`, or an `<input>` that holds text: no `type`, or type text, search, url, email
// or tel. Other inputs (number, date, checkbox, file, password) aren't text and are fine, and so
// is a `type` worked out in code (a password a user can show).
//
//   pnpm lint:text-fields

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const TEXT_TYPES = new Set(["text", "search", "url", "email", "tel"]);

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (path.endsWith(".tsx")) yield path;
  }
}

/** Why a JSX element is a text box that should be a TextField, or null. */
function problem(tag: string, attributes: ts.JsxAttributes): string | null {
  if (tag === "textarea") return "a <textarea>";
  if (tag !== "input") return null;
  const type = attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "type",
  );
  if (!type) return "an <input> with no type";
  const value = type.initializer;
  if (value && ts.isStringLiteral(value) && TEXT_TYPES.has(value.text)) {
    return `an <input type="${value.text}">`;
  }
  return null;
}

const found: string[] = [];
for (const app of readdirSync(join(root, "apps"))) {
  const src = join(root, "apps", app, "src");
  try {
    statSync(src);
  } catch {
    continue;
  }
  for (const path of sources(src)) {
    const file = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const why = problem(node.tagName.getText(), node.attributes);
        if (why) {
          const { line } = file.getLineAndCharacterOfPosition(node.getStart());
          found.push(`${relative(root, path)}:${line + 1}: ${why}; use TextField from @g3/ui`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
}

if (found.length > 0) {
  console.error(found.join("\n"));
  console.error(`\n${found.length} text box(es) not using TextField.`);
  process.exit(1);
}
console.log("Every text box is a TextField.");
