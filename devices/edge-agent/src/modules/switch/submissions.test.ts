import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SoundLibrary } from "./sounds";
import { SoundSubmissions } from "./submissions";
const wave = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]);
test("student audio stays outside playback until approval and survives restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "g3-submissions-"));
  const library = new SoundLibrary(dir, []);
  const queue = new SoundSubmissions(dir, library);
  try {
    const first = await queue.submit("Request.wav", wave, "student", "Sam");
    await queue.submit("Other.wav", wave, "other", "Olive");
    expect(await library.paths()).toEqual([]);
    expect((await queue.list("student")).map((s) => s.id)).toEqual([first.id]);
    const restarted = new SoundSubmissions(dir, library);
    expect((await restarted.get(first.id)).status).toBe("pending");
    expect(
      new Uint8Array(await Bun.file(await restarted.soundPath(first.id)).arrayBuffer()),
    ).toEqual(wave);
    expect((await restarted.review(first.id, "approved", "admin")).status).toBe("approved");
    expect(await library.paths()).toEqual([join(dir, "Request.wav")]);
    await expect(restarted.soundPath(first.id)).rejects.toThrow("already been reviewed");
    await expect(restarted.review(first.id, "approved", "admin")).rejects.toThrow(
      "already been reviewed",
    );
    const other = (await queue.list("other"))[0];
    expect((await queue.review(other.id, "rejected", "admin")).status).toBe("rejected");
    expect((await library.list()).map((s) => s.name)).toEqual(["Request.wav"]);
    const duplicate = await queue.submit("Request.wav", wave, "student", "Sam");
    await expect(queue.review(duplicate.id, "approved", "admin")).rejects.toThrow("already exists");
    expect((await queue.get(duplicate.id)).status).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("validates uploads and enforces pending quotas even for concurrent submissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "g3-submissions-limit-"));
  const queue = new SoundSubmissions(dir, new SoundLibrary(dir, []));
  try {
    await expect(queue.submit("../bad.wav", wave, "student", "Sam")).rejects.toThrow("filename");
    await expect(queue.submit("bad.wav", new Uint8Array(12), "student", "Sam")).rejects.toThrow(
      "valid",
    );
    await expect(queue.get("../../bad")).rejects.toThrow("Invalid");
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) => queue.submit(`Clip${i}.wav`, wave, "student", "Sam")),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await queue.list("student")).toHaveLength(3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
