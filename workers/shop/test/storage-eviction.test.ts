// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import {
  isStorageFileExpired,
  notifyStorageCleanup,
  storageRetentionCutoff,
  withStorageLimit,
  withTeam,
} from "@g3/auth";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createShopDb } from "../src/db";
import { files } from "../src/db/schema";
import { shopStorageEviction } from "../src/lib/storage-limit";
import type { AppEnv } from "../src/types";

const bindings = env as unknown as AppEnv["Bindings"];
const { SHOP_DB: database, DRAWINGS: bucket } = bindings;
const limit = { bytes: 100, objects: 10, label: "100 bytes" };

async function reviewedEviction(team: string) {
  const page = await bucket.list({ prefix: `teams/${team}/` });
  return {
    ...shopStorageEviction(bindings, team),
    deleteOldest: false,
    approvedObjects: new Map(page.objects.map((file) => [file.key, file.etag])),
  };
}

describe("reviewed storage cleanup", () => {
  it("uses six calendar months and protects the exact boundary and unknown dates", () => {
    const now = Date.UTC(2026, 10, 6, 12, 34, 56);
    const cutoff = Date.UTC(2026, 4, 6, 12, 34, 56);
    expect(storageRetentionCutoff(now)).toBe(cutoff);
    expect(isStorageFileExpired(cutoff - 1, now)).toBe(true);
    expect(isStorageFileExpired(cutoff, now)).toBe(false);
    expect(isStorageFileExpired(cutoff + 1, now)).toBe(false);
    expect(isStorageFileExpired(new Date(Number.NaN), now)).toBe(false);
    expect(isStorageFileExpired(0, now)).toBe(false);
    expect(storageRetentionCutoff(Date.UTC(2026, 7, 31, 12))).toBe(Date.UTC(2026, 1, 28, 12));
    expect(storageRetentionCutoff(Date.UTC(2024, 7, 31, 12))).toBe(Date.UTC(2024, 1, 29, 12));
  });

  it("automatically cleans expired files toward 90% while keeping recent files", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    const old = `${prefix}old`;
    const recent = `${prefix}recent`;
    await bucket.put(old, "x".repeat(40));
    await bucket.put(recent, "x".repeat(30));
    const agedBucket = {
      list: async (options: R2ListOptions) => {
        const page = await bucket.list(options);
        return {
          ...page,
          objects: page.objects.map((file) => ({
            ...file,
            uploaded:
              file.key === old ? new Date(storageRetentionCutoff() - 86_400_000) : file.uploaded,
          })),
        };
      },
      delete: (keys: string | string[]) => bucket.delete(keys),
    } as R2Bucket;
    const key = `${prefix}new`;
    await withStorageLimit(
      database,
      agedBucket,
      team,
      prefix,
      [{ key, bytes: 60 }],
      limit,
      () => bucket.put(key, "x".repeat(60)),
      shopStorageEviction(bindings, team),
    );
    expect(await bucket.head(old)).toBeNull();
    expect((await bucket.head(recent))?.size).toBe(30);
    expect((await bucket.list({ prefix })).objects.reduce((sum, file) => sum + file.size, 0)).toBe(
      90,
    );
  });

  it("continues into recent files when expired files cannot reach the cleanup target", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    await bucket.put(`${prefix}old`, "x".repeat(5));
    await bucket.put(`${prefix}recent`, "x".repeat(95));
    const agedBucket = {
      list: async (options: R2ListOptions) => {
        const page = await bucket.list(options);
        return {
          ...page,
          objects: page.objects.map((file) => ({
            ...file,
            uploaded: file.key.endsWith("/old")
              ? new Date(storageRetentionCutoff() - 86_400_000)
              : file.uploaded,
          })),
        };
      },
      delete: (keys: string | string[]) => bucket.delete(keys),
    } as R2Bucket;
    await withStorageLimit(
      database,
      agedBucket,
      team,
      prefix,
      [{ key: `${prefix}new`, bytes: 10 }],
      limit,
      () => bucket.put(`${prefix}new`, "x".repeat(10)),
      shopStorageEviction(bindings, team),
    );
    expect(await bucket.head(`${prefix}old`)).toBeNull();
    expect(await bucket.head(`${prefix}recent`)).toBeNull();
    expect((await bucket.head(`${prefix}new`))?.size).toBe(10);
  });
  it("leaves files alone when automatic cleanup and explicit approvals are both off", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    await bucket.put(`${prefix}valuable-old`, "x".repeat(100));
    await expect(
      withStorageLimit(
        database,
        bucket,
        team,
        prefix,
        [{ key: `${prefix}new`, bytes: 5 }],
        limit,
        () => bucket.put(`${prefix}new`, "new"),
        { ...shopStorageEviction(bindings, team), deleteOldest: false },
      ),
    ).rejects.toMatchObject({ code: "storage_full" });
    expect((await bucket.head(`${prefix}valuable-old`))?.size).toBe(100);
    expect(await bucket.head(`${prefix}new`)).toBeNull();
  });

  it("does not delete an approved file if its contents changed after review", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    const key = `${prefix}reviewed`;
    await bucket.put(key, "x".repeat(100));
    const reviewed = await reviewedEviction(team);
    await bucket.put(key, "y".repeat(100));
    await expect(
      withStorageLimit(
        database,
        bucket,
        team,
        prefix,
        [{ key: `${prefix}new`, bytes: 5 }],
        limit,
        () => bucket.put(`${prefix}new`, "new"),
        reviewed,
      ),
    ).rejects.toMatchObject({ code: "storage_full" });
    expect(await (await bucket.get(key))?.text()).toBe("y".repeat(100));
  });
  it("also leaves 10% headroom when the file-count cap triggers cleanup", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    for (let i = 0; i < 10; i++)
      await bucket.put(`${prefix}${String(i).padStart(2, "0")}-old`, "x");
    const key = `${prefix}new`;
    await withStorageLimit(
      database,
      bucket,
      team,
      prefix,
      [{ key, bytes: 1 }],
      { bytes: 1000, objects: 10, label: "1000 bytes" },
      () => bucket.put(key, "x"),
      shopStorageEviction(bindings, team),
    );
    expect((await bucket.list({ prefix })).objects).toHaveLength(9);
    expect(await bucket.head(`${prefix}00-old`)).toBeNull();
    expect(await bucket.head(`${prefix}01-old`)).toBeNull();
    expect(await bucket.head(key)).not.toBeNull();
  });
  it("cleans down to 90% including the incoming upload, then leaves room before cleaning again", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    const db = createShopDb(database);
    for (const name of ["01-old", "02-recent"]) {
      const bytes = name === "01-old" ? 40 : 30;
      await bucket.put(`${prefix}${name}`, "x".repeat(bytes));
      await db.insert(files).values(
        withTeam(team, {
          filename: name,
          r2Key: `${prefix}${name}`,
          contentType: "text/plain",
          fileSize: bytes,
          uploadedBy: "test",
          createdAt: Date.now(),
        }),
      );
    }
    const key = `${prefix}03-new`;
    await withStorageLimit(
      database,
      bucket,
      team,
      prefix,
      [{ key, bytes: 60 }],
      limit,
      () => bucket.put(key, "x".repeat(60)),
      await reviewedEviction(team),
    );
    expect(await bucket.head(`${prefix}01-old`)).toBeNull();
    expect((await bucket.head(`${prefix}02-recent`))?.size).toBe(30);
    expect((await bucket.head(key))?.size).toBe(60);
    expect(
      (await db.select().from(files).where(eq(files.teamId, team))).map((file) => file.filename),
    ).toEqual(["02-recent"]);
    const next = `${prefix}04-next`;
    await withStorageLimit(
      database,
      bucket,
      team,
      prefix,
      [{ key: next, bytes: 5 }],
      limit,
      () => bucket.put(next, "x".repeat(5)),
      await reviewedEviction(team),
    );
    expect((await bucket.head(`${prefix}02-recent`))?.size).toBe(30);
    expect((await bucket.list({ prefix })).objects.reduce((sum, file) => sum + file.size, 0)).toBe(
      95,
    );
  });

  it("protects the incoming replacement and never touches another team's files", async () => {
    const team = newTeamId();
    const other = newTeamId();
    const prefix = `teams/${team}/`;
    const replace = `${prefix}01-replace`;
    await bucket.put(replace, "x".repeat(80));
    await bucket.put(`${prefix}02-old`, "x".repeat(20));
    await bucket.put(`teams/${other}/old`, "x".repeat(90));
    await withStorageLimit(
      database,
      bucket,
      team,
      prefix,
      [{ key: replace, bytes: 90 }],
      limit,
      () => bucket.put(replace, "x".repeat(90)),
      await reviewedEviction(team),
    );
    expect((await bucket.head(replace))?.size).toBe(90);
    expect(await bucket.head(`${prefix}02-old`)).toBeNull();
    expect((await bucket.head(`teams/${other}/old`))?.size).toBe(90);
  });

  it("does not delete old data when a new write or validation fails", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    await bucket.put(`${prefix}old`, "x".repeat(100));
    const removeReferences = vi.fn();
    const approvedObjects = (await reviewedEviction(team)).approvedObjects;
    await expect(
      withStorageLimit(
        database,
        bucket,
        team,
        prefix,
        [{ key: `${prefix}new`, bytes: 5 }],
        limit,
        async () => {
          throw new Error("failed save");
        },
        { removeReferences, approvedObjects },
      ),
    ).rejects.toThrow("failed save");
    const refused = await withStorageLimit(
      database,
      bucket,
      team,
      prefix,
      [{ key: `${prefix}new`, bytes: 5 }],
      limit,
      async () => new Response("not valid", { status: 409 }),
      { removeReferences, approvedObjects },
    );
    expect(refused.status).toBe(409);
    expect(removeReferences).not.toHaveBeenCalled();
    expect((await bucket.head(`${prefix}old`))?.size).toBe(100);
  });

  it("does not delete anything when an incoming upload cannot fit on its own", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    await bucket.put(`${prefix}old`, "x".repeat(100));
    await expect(
      withStorageLimit(
        database,
        bucket,
        team,
        prefix,
        [{ key: `${prefix}new`, bytes: 101 }],
        limit,
        async () => bucket.put(`${prefix}new`, "x".repeat(101)),
        await reviewedEviction(team),
      ),
    ).rejects.toMatchObject({ code: "storage_full" });
    expect((await bucket.head(`${prefix}old`))?.size).toBe(100);
    expect(await bucket.head(`${prefix}new`)).toBeNull();
  });

  it("sends admins size and age summaries, batching follow-up messages", async () => {
    const team = newTeamId();
    const endpoint = `http://g3id/api/internal/teams/${team}/chat/dm-members`;
    const uploaded = new Date(Date.now() - 100 * 86_400_000);
    const notify = () =>
      notifyStorageCleanup(bindings, team, "shop", [{ size: 1024 ** 2, uploaded }], database);
    await notify();
    await notify();
    let messages = (await (await bindings.G3ID.fetch(endpoint)).json()) as {
      userIds: string[];
      text: string;
    }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].userIds).toEqual([teamUsers(team).admin.id]);
    expect(messages[0].text).toContain("1.0 MB");
    expect(messages[0].text).toContain("100–100 days ago");
    await database
      .prepare("UPDATE storage_cleanup_notices SET last_sent_at = ? WHERE team_id = ?")
      .bind(Date.now() - 3_600_001, team)
      .run();
    await notify();
    messages = (await (await bindings.G3ID.fetch(endpoint)).json()) as {
      userIds: string[];
      text: string;
    }[];
    expect(messages).toHaveLength(2);
    expect(messages[1].text).toContain("Removed 2 oldest files (2.0 MB)");
  });
});
