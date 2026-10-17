import assert from "node:assert/strict";
import { test } from "node:test";
import { TierListAutosave } from "../src/tier-list-autosave.ts";

test("coalesces rapid edits into the latest snapshot", async () => {
  const writes: string[] = [];
  const queue = new TierListAutosave<string>(async (_id, value) => {
    writes.push(value);
  });
  queue.enqueue("a", "old");
  queue.enqueue("a", "latest");
  await queue.flush();
  assert.deepEqual(writes, ["latest"]);
  assert.equal(queue.status.pending, false);
});

test("serializes edits arriving during a save without dropping a different list", async () => {
  const writes: string[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = new TierListAutosave<string>(async (id, value) => {
    writes.push(`${id}:${value}`);
    if (writes.length === 1) await gate;
  });
  queue.enqueue("a", "first");
  const saving = queue.flush();
  await Promise.resolve();
  queue.enqueue("a", "latest");
  queue.enqueue("b", "other");
  assert.deepEqual(writes, ["a:first"]);
  release();
  await saving;
  assert.deepEqual(writes, ["a:first", "a:latest", "b:other"]);
  assert.equal(queue.status.pending, false);
});

test("retains failed edits for retry, using the newest snapshot", async () => {
  let fail = true;
  const writes: string[] = [];
  const queue = new TierListAutosave<string>(async (_id, value) => {
    if (fail) throw new Error("Offline");
    writes.push(value);
  });
  queue.enqueue("a", "first");
  await queue.flush();
  assert.equal(queue.status.error, "Offline");
  assert.equal(queue.status.pending, true);
  fail = false;
  queue.enqueue("a", "latest");
  await queue.flush();
  assert.deepEqual(writes, ["latest"]);
  assert.equal(queue.status.pending, false);
  assert.equal(queue.status.error, "");
});
