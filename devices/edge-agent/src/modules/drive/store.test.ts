import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DriveError, DriveStore, parseRange, safeName, uniqueName } from "./store";

const stream = (text: string) => new Response(text).body;

describe("safeName", () => {
  test("allows ordinary names", () => {
    expect(safeName(" CAD export v2.step ")).toBe("CAD export v2.step");
    expect(safeName("Ünïcødé – 2026.pdf")).toBe("Ünïcødé – 2026.pdf");
  });
  test("rejects paths, dot names, control characters, and long names", () => {
    for (const bad of [
      "",
      ".",
      "..",
      "../etc/passwd",
      "a/b",
      "a\\b",
      ".hidden",
      ".upload-x",
      "a\nb",
      "x".repeat(256),
    ]) {
      expect(safeName(bad)).toBeNull();
    }
  });
});

describe("uniqueName", () => {
  test("adds (1), (2), ... before the extension", () => {
    const taken = new Set(["a.pdf", "a (1).pdf", "README"]);
    expect(uniqueName("b.pdf", (n) => taken.has(n))).toBe("b.pdf");
    expect(uniqueName("a.pdf", (n) => taken.has(n))).toBe("a (2).pdf");
    expect(uniqueName("README", (n) => taken.has(n))).toBe("README (1)");
  });
});

describe("parseRange", () => {
  test("handles start-end, open-ended, suffix, and bad ranges", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull(); // multi-range: send the whole file
  });
});

describe("DriveStore", () => {
  test("uploads, lists, renames on clash, and deletes", async () => {
    const store = new DriveStore(mkdtempSync(join(tmpdir(), "g3-drive-")), false);
    expect(await store.upload("notes.txt", stream("one"), 3)).toBe("notes.txt");
    expect(await store.upload("notes.txt", stream("two"), 3)).toBe("notes (1).txt");
    expect(
      store
        .list()
        .map((f) => [f.name, f.size])
        .sort(),
    ).toEqual([
      ["notes (1).txt", 3],
      ["notes.txt", 3],
    ]);
    store.remove("notes.txt");
    expect(store.list().map((f) => f.name)).toEqual(["notes (1).txt"]);
    expect(() => store.remove("notes.txt")).toThrow(DriveError);
    expect(() => store.file("../../etc/passwd")).toThrow("isn't on the drive");
    // No temp files left behind.
    expect(readdirSync(store.dir).filter((n) => n.startsWith("."))).toEqual([]);
  });

  test("rejects uploads that can't fit", async () => {
    const store = new DriveStore(mkdtempSync(join(tmpdir(), "g3-drive-")), false);
    const tooBig = store.usage().free + 1;
    await expect(store.upload("big.bin", stream("x"), tooBig)).rejects.toThrow("enough space");
  });

  test("refuses to work when the drive image isn't mounted", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "g3-drive-")), "g3-drive");
    mkdirSync(dir);
    const store = new DriveStore(dir, true);
    expect(() => store.list()).toThrow("isn't mounted");
    await expect(store.upload("a.txt", stream("x"), 1)).rejects.toThrow("isn't mounted");
    expect(existsSync(join(dir, "a.txt"))).toBe(false);
  });

  test("cleans up interrupted uploads", async () => {
    const store = new DriveStore(mkdtempSync(join(tmpdir(), "g3-drive-")), false);
    await Bun.write(join(store.dir, ".upload-abc"), "partial");
    store.cleanupTemp();
    expect(readdirSync(store.dir)).toEqual([]);
  });
});
