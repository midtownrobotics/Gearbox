import assert from "node:assert/strict";
import { test } from "node:test";
import { type ScoutingDraft, readScoutingDraft } from "../src/scouting-drafts.ts";

const snapshot: ScoutingDraft = {
  assignment: "event_qm1:123",
  fields: "fields-v1",
  expiresAt: 2000,
  teamName: "123",
  answers: { count: 0, multiple: ["0"], note: "Android draft" },
  drawings: { path: "data:image/png;base64,abc" },
};
function storage(value: string) {
  const entries = new Map([["scout-a", value]]);
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}
test("restores zero answers, multiple selections and drawings for the same assignment", () => {
  const store = storage(JSON.stringify(snapshot));
  assert.deepEqual(
    readScoutingDraft(store, "scout-a", snapshot.assignment, snapshot.fields, 1000),
    snapshot,
  );
  assert.equal(
    readScoutingDraft(store, "scout-b", snapshot.assignment, snapshot.fields, 1000),
    null,
  );
});
test("removes expired, changed-assignment and changed-form drafts", () => {
  for (const [assignment, fields, now] of [
    [snapshot.assignment, snapshot.fields, 2000],
    ["event_qm2:123", snapshot.fields, 1000],
    [snapshot.assignment, "changed-fields", 1000],
  ] as const) {
    const store = storage(JSON.stringify(snapshot));
    assert.equal(readScoutingDraft(store, "scout-a", assignment, fields, now), null);
    assert.equal(store.getItem("scout-a"), null);
  }
});
test("pit drafts have no match deadline", () => {
  const pit = { ...snapshot, assignment: "pit", expiresAt: null };
  assert.deepEqual(
    readScoutingDraft(storage(JSON.stringify(pit)), "scout-a", "pit", pit.fields, 9000),
    pit,
  );
});
test("discards corrupted data instead of breaking the form", () => {
  for (const raw of [
    "not json",
    "null",
    JSON.stringify({ ...snapshot, drawings: { path: "bad image" } }),
    JSON.stringify({ ...snapshot, answers: [] }),
  ]) {
    const store = storage(raw);
    assert.equal(
      readScoutingDraft(store, "scout-a", snapshot.assignment, snapshot.fields, 1000),
      null,
    );
    assert.equal(store.getItem("scout-a"), null);
  }
});
