const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// This pure module has only type imports. Compile with the app's TypeScript so Node can exercise
// the same ordering and aggregation used by the interface without requiring a browser.
const source = fs.readFileSync(path.join(__dirname, "../src/analysis-table.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const table = {};
new Function("exports", compiled.outputText)(table);
const report = (id, teamName, matchKey, createdAt) => ({
  id,
  teamName,
  matchKey,
  createdAt,
  eventKey: "event",
  formKind: "scouting",
  fields: [],
  answers: {},
  drawings: {},
  starredFieldIds: [],
});
const reports = [
  report("late", "2", "event_qm2", 100),
  report("new", "2", "event_qm20", 20),
  report("other", "10", "event_qm9", 30),
  report("unknown", "11", undefined, 200),
  report("playoff", "12", "event_sf3m1", 40),
];
assert.deepEqual(
  table.newestFirst(reports).map((item) => item.id),
  ["playoff", "new", "other", "late", "unknown"],
);
const rows = table.sortRows(table.teamRows(reports, [], "scouting"), {
  key: "recent",
  dir: "desc",
});
assert.deepEqual(
  rows.map((row) => row.team),
  ["12", "2", "10", "11"],
);
assert.deepEqual(
  rows.find((row) => row.team === "2").reports.map((item) => item.id),
  ["new", "late"],
);
assert.deepEqual(
  table.sortRows(rows, { key: "team", dir: "asc" }).map((row) => row.team),
  ["2", "10", "11", "12"],
);
assert.deepEqual(
  table.chronological(reports).map((item) => item.id),
  ["late", "other", "new", "playoff", "unknown"],
);
const pit = table.teamRows(reports.slice(0, 2), [], "pit");
assert.equal(pit[0].reports[0].id, "late");
console.log(
  "Stats orders teams and reports by match recency, keeps late uploads in their match, preserves Auto order and uses submission time for pit reports.",
);

const stored = new Map();
const localStorage = {
  get length() {
    return stored.size;
  },
  key(index) {
    return [...stored.keys()][index] ?? null;
  },
  getItem(key) {
    return stored.get(key) ?? null;
  },
  setItem(key, value) {
    stored.set(key, value);
  },
  removeItem(key) {
    stored.delete(key);
  },
};
const draftSource = fs.readFileSync(path.join(__dirname, "../src/match-drafts.ts"), "utf8");
const drafts = {};
new Function(
  "exports",
  "window",
  ts.transpileModule(draftSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(drafts, { localStorage });
const draft = (formId, matchKey, answers) => ({
  formId,
  matchKey,
  matchLabel: "Qual 1",
  teamName: "101",
  answers,
  drawings: {},
  savedAt: Date.now(),
});
drafts.saveDraft("scout", draft("auto", "event_qm1", { path: "no-minimal-movement" }));
drafts.saveDraft("scout", draft("score", "event_qm1", { count: 0 }));
assert.deepEqual(drafts.loadDraft("scout", "auto", "event_qm1").answers, {
  path: "no-minimal-movement",
});
assert.deepEqual(drafts.loadDraft("scout", "score", "event_qm1").answers, { count: 0 });
drafts.deleteDraft("scout", "score", "event_qm1");
assert.equal(drafts.loadDraft("scout", "score", "event_qm1"), null);
assert.equal(drafts.listDrafts("scout", "auto").length, 1);
assert.equal(drafts.loadDraft("another-scout", "auto", "event_qm1"), null);
for (const number of ["101", "102"])
  drafts.saveDraft("scout", draft("pit", `__pit__:${number}`, { note: number }));
assert.equal(drafts.loadDraft("scout", "pit", "__pit__:101").answers.note, "101");
assert.equal(drafts.loadDraft("scout", "pit", "__pit__:102").answers.note, "102");
console.log(
  "Drafts retain explicit no/minimal movement, zero answers and separate forms, teams and scouts.",
);
