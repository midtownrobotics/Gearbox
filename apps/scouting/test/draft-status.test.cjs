const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(name, window) {
  const source = fs.readFileSync(path.join(__dirname, `../src/${name}.ts`), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  new Function("exports", "window", compiled.outputText)(exports, window);
  return exports;
}
function store() {
  const rows = new Map();
  return {
    get length() {
      return rows.size;
    },
    key(index) {
      return [...rows.keys()][index] ?? null;
    },
    getItem(key) {
      return rows.get(key) ?? null;
    },
    setItem(key, value) {
      rows.set(key, value);
    },
    removeItem(key) {
      rows.delete(key);
    },
  };
}
const draft = {
  formId: "form",
  matchKey: "event_qm1",
  matchLabel: "Qual 1",
  teamName: "101",
  answers: { count: 0 },
  drawings: {},
  savedAt: Date.now(),
};
const storage = store();
const drafts = load("match-drafts", { localStorage: storage });
assert.equal(drafts.saveDraft("scout", draft), "saved");
assert.deepEqual(drafts.loadDraft("scout", "form", "event_qm1").answers, { count: 0 });
assert.equal(drafts.loadDraft("other-scout", "form", "event_qm1"), null);
drafts.saveDraft("scout", { ...draft, formId: "another-form", answers: { count: 5 } });
assert.equal(drafts.loadDraft("scout", "form", "event_qm1").answers.count, 0);
assert.equal(drafts.saveDraft("scout", { ...draft, answers: {} }), "empty");
assert.equal(drafts.loadDraft("scout", "form", "event_qm1"), null);

const blocked = load("match-drafts", {
  get localStorage() {
    throw new Error("Blocked");
  },
});
assert.equal(blocked.saveDraft("scout", draft), "failed");
const full = load("match-drafts", {
  localStorage: {
    ...store(),
    setItem() {
      throw new Error("Full");
    },
  },
});
assert.equal(full.saveDraft("scout", draft), "failed");
const limitedStorage = store();
const write = limitedStorage.setItem;
limitedStorage.setItem = (key, value) => {
  if (Object.keys(JSON.parse(value).drawings).length) throw new Error("Drawing too large");
  write(key, value);
};
const limited = load("match-drafts", { localStorage: limitedStorage });
assert.equal(limited.saveDraft("scout", { ...draft, drawings: { auto: "image-data" } }), "partial");
const recovered = limited.loadDraft("scout", "form", "event_qm1");
assert.deepEqual(recovered.answers, { count: 0 });
assert.deepEqual(recovered.drawings, {});
assert.deepEqual(recovered.missingDrawingFields, ["auto"]);
assert.equal(limited.saveDraft("scout", recovered), "partial");
assert.equal(
  limited.hasContent({ answers: {}, drawings: {}, missingDrawingFields: ["auto"] }),
  true,
);

const { draftStatusText } = load("draft-status");
assert.equal(draftStatusText("saved", "idle", false), "Saved on this device · Not submitted");
assert.match(draftStatusText("saved", "failed", false), /^Not submitted\. Saved on this device/);
assert.match(draftStatusText("failed", "failed", false), /Could not save/);
assert.match(draftStatusText("partial", "idle", false), /some drawings are not saved/);
assert.equal(draftStatusText("saved", "idle", true), "Submitting…");
assert.equal(draftStatusText("failed", "submitted", false), "Submitted to the server");
console.log(
  "Draft status distinguishes local saves, partial/blocked storage, failed submission, submitting and server confirmation; partial drawing warnings survive reloads.",
);
