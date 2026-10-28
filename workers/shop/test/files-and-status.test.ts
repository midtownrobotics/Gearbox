import { env } from "cloudflare:test";
import { admin, kioskAdmin, student } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import type { StoredFile } from "../src/lib/batches";
import { DEFAULT_STATUS_LEVELS } from "../src/lib/shop-status";
import { drawingKey } from "../src/lib/storage";

// Deleting many files and drawings at once (the Files page's Delete selected and Delete all), and
// the Overview's shop status words, which admins edit.

const bucket = (env as unknown as { DRAWINGS: R2Bucket }).DRAWINGS;
const post = (body?: unknown) => ({ method: "POST", body });

async function upload() {
  const form = new FormData();
  form.set("file", new File(["G-code"], `nest-${crypto.randomUUID()}.nc`, { type: "text/plain" }));
  return jsonAs<StoredFile>(student, "/part-files", { method: "POST", body: form }, 201);
}

describe("deleting several files", () => {
  it("deletes the files chosen and leaves the rest", async () => {
    const [a, b, keep] = await Promise.all([upload(), upload(), upload()]);
    const res = await jsonAs<{ deleted: number }>(
      student,
      "/part-files/delete",
      post({ ids: [a.id, b.id, 999_999_999] }),
    );
    expect(res.deleted).toBe(2);
    const left = (await jsonAs<StoredFile[]>(student, "/part-files")).map((f) => f.id);
    expect(left).toContain(keep.id);
    expect(left).not.toContain(a.id);
    expect(left).not.toContain(b.id);
  });

  it("refuses kiosks and an empty or bad list", async () => {
    const file = await upload();
    expect((await callAs(kioskAdmin, "/part-files/delete", post({ ids: [file.id] }))).status).toBe(
      403,
    );
    expect((await callAs(student, "/part-files/delete", post({ ids: [] }))).status).toBe(400);
    expect((await callAs(student, "/part-files/delete", post({ ids: ["1"] }))).status).toBe(400);
  });
});

describe("deleting several drawings", () => {
  it("deletes the drawings chosen and leaves the rest", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const team = student.teamId;
    for (const pn of [`A-${tag}`, `B-${tag}`, `C-${tag}`]) {
      await bucket.put(drawingKey(team, pn, "A"), "%PDF");
    }
    const res = await jsonAs<{ deleted: number }>(
      student,
      "/drawings/delete",
      post({
        drawings: [
          { partNumber: `A-${tag}`, revision: "A" },
          { partNumber: `B-${tag}`, revision: "A" },
          { partNumber: `Z-${tag}`, revision: "A" },
        ],
      }),
    );
    expect(res.deleted).toBe(2);
    expect(await bucket.head(drawingKey(team, `A-${tag}`, "A"))).toBeNull();
    expect(await bucket.head(drawingKey(team, `C-${tag}`, "A"))).not.toBeNull();
  });

  it("refuses kiosks and a part number with a slash", async () => {
    const one = [{ partNumber: "X", revision: "A" }];
    expect((await callAs(kioskAdmin, "/drawings/delete", post({ drawings: one }))).status).toBe(
      403,
    );
    const slash = [{ partNumber: "../X", revision: "A" }];
    expect((await callAs(student, "/drawings/delete", post({ drawings: slash }))).status).toBe(400);
  });
});

describe("shop status words", () => {
  type Me = { statusLevels: { label: string; below: number | null }[] };
  const put = (levels: unknown) => ({ method: "PUT", body: { levels } });

  it("starts with the app's own and saves an admin's", async () => {
    expect((await jsonAs<Me>(student, "/me")).statusLevels).toEqual(DEFAULT_STATUS_LEVELS);
    const levels = [
      { label: "Calm", below: 3 },
      { label: "On fire", below: null },
    ];
    expect((await callAs(admin, "/admin/shop-status", put(levels))).status).toBe(200);
    expect((await jsonAs<Me>(student, "/me")).statusLevels).toEqual(levels);
    await callAs(admin, "/admin/shop-status", put(DEFAULT_STATUS_LEVELS));
  });

  it("is only for admins, and refuses statuses that don't add up", async () => {
    const ok = [{ label: "Only", below: null }];
    expect((await callAs(student, "/admin/shop-status", put(ok))).status).toBe(403);
    for (const bad of [
      [],
      [{ label: "", below: null }],
      [{ label: "Last has a limit", below: 5 }],
      [
        { label: "A", below: 10 },
        { label: "B", below: 5 },
        { label: "C", below: null },
      ],
    ]) {
      expect((await callAs(admin, "/admin/shop-status", put(bad))).status).toBe(400);
    }
  });
});
