// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import {
  type StorageReport,
  bucketStorageReport,
  isStorageFileExpired,
  notifyStorageUsage,
  storageArchiveParts,
  storageArchiveSelection,
  storageEligibleAfter,
  withStorageLimit,
} from "@g3/auth";
import { newTeamId } from "@g3/testing/users";
import { call } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

const { SHOP_DB: database, DRAWINGS: bucket } = env as unknown as {
  SHOP_DB: D1Database;
  DRAWINGS: R2Bucket;
};
const path = (team: string) => `/api/internal/teams/${team}/storage`;
function chat() {
  const messages: { userIds: string[]; text: string }[] = [];
  const G3ID = {
    fetch: async (request: Request) => {
      if (request.url.endsWith("/members"))
        return Response.json([
          { id: "admin", status: "active", isAdmin: true },
          { id: "student", status: "active", isAdmin: false },
          { id: "pending", status: "pending", isAdmin: true },
        ]);
      if (request.url.endsWith("/chat/dm-members")) messages.push(await request.json());
      return Response.json({ sent: 1, ok: true });
    },
  } as Fetcher;
  return { env: { G3ID }, messages };
}

describe("storage reporting and downloads", () => {
  it("splits large backups into bounded, non-overlapping parts without dropping files", () => {
    const files = Array.from({ length: 2501 }, (_, index) => ({
      key: `file-${String(index).padStart(5, "0")}`,
      name: "same.png",
      bytes: 1,
      uploadedAt: 1,
      eligible: true,
    }));
    const parts = storageArchiveParts(files);
    expect(parts.map((part) => part.count)).toEqual([1000, 1000, 501]);
    expect(
      parts
        .flatMap((part) => storageArchiveSelection(files, part.from, part.to))
        .map((file) => file.key),
    ).toEqual(files.map((file) => file.key));
    expect(storageArchiveSelection(files)).toHaveLength(1000);
    expect(
      storageArchiveParts(files.slice(0, 2).map((file) => ({ ...file, bytes: 300 * 1024 ** 2 }))),
    ).toHaveLength(2);
  });
  it("reports only its own files and downloads their real bytes", async () => {
    const a = newTeamId();
    const b = newTeamId();
    const key = `teams/${a}/drawing.pdf`;
    await bucket.put(key, "drawing bytes");
    await bucket.put(`teams/${b}/private.pdf`, "other-team-secret");
    const report = await (await call(path(a))).json<StorageReport>();
    expect(report.allowances[0].count).toBe(1);
    expect(report.allowances[0].files[0]).toMatchObject({
      name: "drawing.pdf",
      eligible: true,
      bytes: 13,
    });
    expect(JSON.stringify(report)).not.toContain(b);
    const file = await call(`${path(a)}/download?key=${encodeURIComponent(key)}`);
    expect(file.headers.get("Content-Disposition")).toContain("attachment");
    expect(await file.text()).toBe("drawing bytes");
    expect(
      (await call(`${path(a)}/download?key=${encodeURIComponent(`teams/${b}/private.pdf`)}`))
        .status,
    ).toBe(404);
  });

  it("streams a complete archive, and eligible-only downloads exclude protected files", async () => {
    const team = newTeamId();
    await bucket.put(`teams/${team}/photo.png`, "photo-content");
    const response = await call(`${path(team)}/archive`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect(response.headers.get("Content-Type")).toBe("application/x-tar");
    expect(text).toContain("1-photo.png");
    expect(text).toContain("photo-content");
    expect(text).toContain("manifest.json");
    // The first tar checksum and size are consumable by ordinary archive tools.
    const storedChecksum = Number.parseInt(new TextDecoder().decode(bytes.slice(148, 154)), 8);
    const header = bytes.slice(0, 512);
    header.fill(32, 148, 156);
    expect(header.reduce((n, b) => n + b, 0)).toBe(storedChecksum);
    const eligible = await call(`${path(team)}/archive?eligible=1`);
    expect(await eligible.text()).toContain("photo-content");
    expect(await bucket.head(`teams/${team}/photo.png`)).not.toBeNull();
  });

  it("counts every page and uses strict month-end eligibility dates", async () => {
    const now = Date.now();
    const fake = {
      list: async ({ cursor }: { cursor?: string }) =>
        cursor
          ? {
              objects: [{ key: "teams/a/recent", size: 2, uploaded: new Date(now) }],
              truncated: false,
            }
          : {
              objects: [
                { key: "teams/a/old", size: 3, uploaded: new Date(now - 300 * 86_400_000) },
              ],
              truncated: true,
              cursor: "next",
            },
    } as R2Bucket;
    const report = await bucketStorageReport(fake, "teams/a/", "Files", {
      bytes: 100,
      objects: 10,
    });
    expect(report.allowances[0]).toMatchObject({ bytes: 5, count: 2 });
    expect(report.allowances[0].files.map((f) => f.eligible)).toEqual([true, true]);
    for (const value of [
      "2026-08-31T14:00:00Z",
      "2026-08-28T14:00:00Z",
      "2026-02-28T14:00:00Z",
      "2027-08-29T14:00:00Z",
    ]) {
      const uploaded = Date.parse(value);
      const after = storageEligibleAfter(uploaded);
      if (after === null) throw new Error("Expected an eligibility date");
      expect(isStorageFileExpired(uploaded, after - 1)).toBe(false);
      expect(isStorageFileExpired(uploaded, after)).toBe(true);
    }
    expect(storageEligibleAfter(0)).toBeNull();
  });
});

describe("storage threshold alerts", () => {
  it("recounts at exactly 90% and never warns from an overestimated fast-save ledger", async () => {
    const team = newTeamId();
    const sent = chat();
    const prefix = `teams/${team}/`;
    const budget = { bytes: 100, objects: 100, label: "test" };
    const eviction = {
      removeReferences: async () => {},
      usage: (usage: { bytes: number; count: number }, attempted?: boolean) =>
        notifyStorageUsage(
          sent.env,
          team,
          "shop",
          "files",
          database,
          usage,
          { bytes: 100, count: 100 },
          attempted,
        ),
    };
    const put = (name: string, bytes: number, fail = false) =>
      withStorageLimit(
        database,
        bucket,
        team,
        prefix,
        [{ key: `${prefix}${name}`, bytes }],
        budget,
        async () => {
          if (fail) throw new Error("save failed");
          return bucket.put(`${prefix}${name}`, "x".repeat(bytes));
        },
        eviction,
      );
    await put("one", 80);
    await expect(put("failed", 8, true)).rejects.toThrow("save failed");
    await put("two", 2); // Ledger would reach 90, but actual files use only 82.
    expect(sent.messages).toHaveLength(0);
    await put("three", 8);
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0].text).toContain("reached 90%");
  });

  it("sends 90, 95, and 100 once, and cleanup to 90 does not repeat them", async () => {
    const team = newTeamId();
    const sent = chat();
    const notify = (count: number) =>
      notifyStorageUsage(
        sent.env,
        team,
        "shop",
        "files",
        database,
        { bytes: 0, count },
        { count: 100 },
      );
    for (const n of [89, 90, 91, 95, 96, 100, 90, 95, 100]) await notify(n);
    expect(sent.messages).toHaveLength(3);
    expect(sent.messages.map((m) => m.text.match(/reached (\d+)%/)?.[1])).toEqual([
      "90",
      "95",
      "100",
    ]);
    expect(sent.messages.every((m) => m.userIds.join() === "admin")).toBe(true);
    await notify(84);
    await notify(90);
    expect(sent.messages).toHaveLength(4);
  });

  it("claims concurrent warnings once and separates teams and allowances", async () => {
    const a = newTeamId();
    const b = newTeamId();
    const sent = chat();
    const notify = (team: string, allowance: string) =>
      notifyStorageUsage(
        sent.env,
        team,
        "pit",
        allowance,
        database,
        { bytes: 96, count: 0 },
        { bytes: 100, count: 10 },
      );
    await Promise.all([notify(a, "assets"), notify(a, "assets"), notify(a, "assets")]);
    expect(sent.messages).toHaveLength(1);
    await notify(a, "logs");
    await notify(b, "assets");
    expect(sent.messages).toHaveLength(3);
    expect(sent.messages[0].text).toContain("95%");
  });

  it("observes successful writes and warns before refusing excess growth", async () => {
    const team = newTeamId();
    const sent = chat();
    const prefix = `teams/${team}/`;
    const key = `${prefix}file`;
    const eviction = {
      removeReferences: async () => {},
      usage: (usage: { bytes: number; count: number }, attempted?: boolean) =>
        notifyStorageUsage(
          sent.env,
          team,
          "shop",
          "files",
          database,
          usage,
          { bytes: 100, count: 10 },
          attempted,
        ),
    };
    await withStorageLimit(
      database,
      bucket,
      team,
      prefix,
      [{ key, bytes: 90 }],
      { bytes: 100, objects: 10, label: "test" },
      () => bucket.put(key, "x".repeat(90)),
      eviction,
    );
    expect(sent.messages).toHaveLength(1);
    await expect(
      withStorageLimit(
        database,
        bucket,
        team,
        prefix,
        [{ key: `${prefix}new`, bytes: 11 }],
        { bytes: 100, objects: 10, label: "test" },
        async () => {
          throw new Error("must not write");
        },
        eviction,
      ),
    ).rejects.toMatchObject({ code: "storage_full" });
    expect(sent.messages).toHaveLength(2);
    expect(sent.messages[1].text).toContain("would reach 100%");
  });
});
