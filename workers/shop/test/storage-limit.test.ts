// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { StorageLimitError, withStorageLimit } from "@g3/auth";
import { newTeamId } from "@g3/testing/users";
import { describe, expect, it } from "vitest";

const { SHOP_DB: database, DRAWINGS: bucket } = env as unknown as {
  SHOP_DB: D1Database;
  DRAWINGS: R2Bucket;
};
const limit = { bytes: 100, objects: 2, label: "100 bytes" };
// Room for many files, so only bytes decide whether a save is near the cap.
const roomy = { ...limit, objects: 100 };

function store(team: string, name: string, bytes: number, budget = limit) {
  const key = `teams/${team}/${name}`;
  return withStorageLimit(database, bucket, team, `teams/${team}/`, [{ key, bytes }], budget, () =>
    bucket.put(key, "x".repeat(bytes)),
  );
}

describe("team storage quotas", () => {
  it("counts existing objects and refuses growth before storing anything", async () => {
    const team = newTeamId();
    await bucket.put(`teams/${team}/legacy`, "x".repeat(90));
    await expect(store(team, "new", 11)).rejects.toMatchObject({ code: "storage_full" });
    expect(await bucket.head(`teams/${team}/new`)).toBeNull();
    expect((await bucket.head(`teams/${team}/legacy`))?.size).toBe(90);
    await store(team, "new", 10);
  });

  it("lets replacements spend only the difference and deletion makes room immediately", async () => {
    const team = newTeamId();
    await store(team, "one", 60);
    await store(team, "two", 40);
    await store(team, "one", 60);
    await expect(store(team, "one", 61)).rejects.toBeInstanceOf(StorageLimitError);
    await bucket.delete(`teams/${team}/two`);
    await store(team, "one", 80);
  });

  it("limits tiny files as well as bytes and keeps teams independent", async () => {
    const a = newTeamId();
    const b = newTeamId();
    await store(a, "one", 1);
    await store(a, "two", 1);
    await expect(store(a, "three", 1)).rejects.toMatchObject({ code: "storage_full" });
    await store(b, "one", 100);
  });

  it("serializes simultaneous uploads so they cannot both spend the same space", async () => {
    const team = newTeamId();
    const results = await Promise.allSettled([store(team, "one", 60), store(team, "two", 60)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "storage_full" });
    const objects = await bucket.list({ prefix: `teams/${team}/` });
    expect(objects.objects).toHaveLength(1);
    expect(objects.objects[0].size).toBe(60);
  });

  it("releases coordination after a failed write so retrying works", async () => {
    const team = newTeamId();
    const key = `teams/${team}/failed`;
    await expect(
      withStorageLimit(
        database,
        bucket,
        team,
        `teams/${team}/`,
        [{ key, bytes: 5 }],
        limit,
        async () => {
          throw new Error("failed write");
        },
      ),
    ).rejects.toThrow("failed write");
    await store(team, "retry", 100);
  });

  it("counts every page of R2 results", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    const empty = await bucket.list({ prefix });
    const listed = {
      ...empty,
      objects: [{ key: `${prefix}old`, size: 90 }],
      truncated: true,
      cursor: "page2",
    };
    const paginated = {
      list: async ({ cursor }: { cursor?: string }) => (cursor ? empty : listed),
    } as R2Bucket;
    await expect(
      withStorageLimit(
        database,
        paginated,
        team,
        prefix,
        [{ key: `${prefix}new`, bytes: 11 }],
        limit,
        async () => {
          throw new Error("must not write");
        },
      ),
    ).rejects.toMatchObject({ code: "storage_full" });
  });

  it("lets saves well under the cap skip the lock another save holds", async () => {
    const team = newTeamId();
    await store(team, "one", 10, roomy);
    await database
      .prepare("INSERT INTO storage_upload_locks (team_id, owner, expires_at) VALUES (?, ?, ?)")
      .bind(team, "someone-else", Date.now() + 60_000)
      .run();
    await store(team, "two", 10, roomy);
    expect((await bucket.head(`teams/${team}/two`))?.size).toBe(10);
    // Past the cleanup target (90 of 100) a save has to count, so it waits for the lock.
    await expect(store(team, "three", 75, roomy)).rejects.toMatchObject({ code: "upload_busy" });
    await database.prepare("DELETE FROM storage_upload_locks WHERE team_id = ?").bind(team).run();
  }, 20_000);

  it("waits for a lock that's let go", async () => {
    const team = newTeamId();
    await database
      .prepare("INSERT INTO storage_upload_locks (team_id, owner, expires_at) VALUES (?, ?, ?)")
      .bind(team, "someone-else", Date.now() + 60_000)
      .run();
    setTimeout(() => {
      void database.prepare("DELETE FROM storage_upload_locks WHERE team_id = ?").bind(team).run();
    }, 500);
    await store(team, "one", 10, roomy);
    expect((await bucket.head(`teams/${team}/one`))?.size).toBe(10);
  });

  it("counts again near the cap, so files deleted elsewhere make room", async () => {
    const team = newTeamId();
    await store(team, "one", 80, roomy);
    await bucket.delete(`teams/${team}/one`);
    await store(team, "two", 80, roomy);
    const usage = await database
      .prepare("SELECT bytes, objects FROM storage_usage WHERE team_id = ?")
      .bind(team)
      .first();
    expect(usage).toEqual({ bytes: 80, objects: 1 });
  });

  it("lets teams already over quota replace a file with a smaller one", async () => {
    const team = newTeamId();
    await bucket.put(`teams/${team}/old`, "x".repeat(150));
    await store(team, "old", 140);
    await expect(store(team, "old", 141)).rejects.toMatchObject({ code: "storage_full" });
  });
});
