// SPDX-License-Identifier: AGPL-3.0-only
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// Pure module with no runtime imports: compile it with the app's TypeScript so Node can
// exercise the same save decisions the quantity box makes, without a browser.
const source = fs.readFileSync(path.join(__dirname, "../src/shared/quantity-edit.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const lib = {};
new Function("exports", compiled.outputText)(lib);
const { isStep, parseQuantity, quantityPatch } = lib;

const navigationSource = fs.readFileSync(
  path.join(__dirname, "../src/shared/entry-navigation.ts"),
  "utf8",
);
const navigationCompiled = ts.transpileModule(navigationSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const navigation = {};
new Function("exports", navigationCompiled.outputText)(navigation);
const { entryBackTarget } = navigation;

/** A native number input's spinner changes the value without blurring; that change must save. */
test("spinner step produces a save patch for the new quantity", () => {
  const parsed = parseQuantity("7");
  assert.deepEqual(parsed, { ok: true, value: 7 });
  assert.deepEqual(quantityPatch(parsed, 6), { kind: "save", quantity: 7 });
});

test("typing a different whole number then blurring produces a save patch", () => {
  assert.deepEqual(quantityPatch(parseQuantity("12"), 7), { kind: "save", quantity: 12 });
  assert.deepEqual(quantityPatch(parseQuantity("0"), 5), { kind: "save", quantity: 0 });
});

test("unchanged value produces no patch", () => {
  assert.deepEqual(quantityPatch(parseQuantity("5"), 5), { kind: "none" });
});

test("invalid input produces an error, never a save", () => {
  for (const bad of ["", "  ", "1.5", "-1", "1000001", "abc", "1e3"]) {
    const parsed = parseQuantity(bad);
    assert.equal(parsed.ok, false, `expected ${JSON.stringify(bad)} invalid`);
    assert.deepEqual(quantityPatch(parsed, 5), { kind: "error" });
  }
});

test("arrow steps save as they happen; typing, deleting and undo wait for Enter or blur", () => {
  for (const step of [undefined, ""]) assert.equal(isStep(step), true);
  for (const typed of ["insertText", "insertFromPaste", "deleteContentBackward", "historyUndo"]) {
    assert.equal(isStep(typed), false, typed);
  }
});

test("returning from an entry restores the originating Locations panels and search", () => {
  const view = { toggled: [[12, true]], query: "wire" };
  assert.deepEqual(entryBackTarget({ from: "/locations", fromState: view }), {
    to: "/locations",
    state: view,
  });
});

test("returning from an entry preserves Inventory table filters", () => {
  assert.deepEqual(entryBackTarget({ from: "/inventory?q=wire&location=4" }), {
    to: "/inventory?q=wire&location=4",
  });
});

test("direct entry visits and unsafe return destinations fall back to Inventory", () => {
  const unsafeStates = [
    null,
    {},
    { from: "https://example.com" },
    { from: "//example.com" },
    { from: "/\\example.com" },
  ];
  for (const state of unsafeStates) {
    assert.deepEqual(entryBackTarget(state), { to: "/inventory" });
  }
});
