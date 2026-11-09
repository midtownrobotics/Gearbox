// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { type StorageReport, storageRetentionCutoff, withTeam } from "@g3/auth";
import { newTeamId } from "@g3/testing/users";
import { call } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { scopePrefix } from "../src/advantagescope";
import { createDb } from "../src/db";
import { matchLogs, scopeAssets, settings } from "../src/db/schema";
import { pitStorageReport } from "../src/storage-report";
import type { AppEnv } from "../src/types";

const bindings = env as unknown as AppEnv["Bindings"];
describe("Pit storage reports", () => {
  it("marks old logs eligible only when the team enabled automatic cleanup", async () => {
    const team = newTeamId();
    const db = createDb(bindings.PIT_DB);
    const old = storageRetentionCutoff() - 86_400_000;
    await db.insert(matchLogs).values(
      withTeam(team, {
        event: "test",
        name: "Qual-1",
        matchType: "q",
        matchNumber: 1,
        size: 1,
        r2Key: `pit/teams/${team}/logs/test/Qual-1.wpilog.gz`,
        status: "stored",
        downloaderName: "Laptop",
        createdAt: old,
        uploadedAt: old,
      }),
    );
    const before = (await pitStorageReport(bindings, team)).allowances.find((a) => a.id === "logs");
    expect(before).toMatchObject({ cleanupEnabled: false });
    expect(before?.files[0].eligible).toBe(false);
    await db
      .insert(settings)
      .values(withTeam(team, { key: "matchLogsWhenFull", value: "delete-oldest" }));
    const after = (await pitStorageReport(bindings, team)).allowances.find((a) => a.id === "logs");
    expect(after).toMatchObject({ cleanupEnabled: true });
    expect(after?.files[0].eligible).toBe(true);
  });

  it("counts asset allowances with orphaned bytes and keeps other teams out", async () => {
    const team = newTeamId();
    const other = newTeamId();
    const key = `${scopePrefix(team)}orphan.glb`;
    await bindings.LOGS.put(key, "model");
    await bindings.LOGS.put(`${scopePrefix(other)}private.glb`, "other-team-secret");
    const response = await call(`/api/internal/teams/${team}/storage`);
    const report = await response.json<StorageReport>();
    expect(report.allowances.find((a) => a.id === "logs")).toMatchObject({
      count: 0,
      countLimit: 20,
    });
    expect(report.allowances.find((a) => a.id === "assets")).toMatchObject({ count: 0, bytes: 5 });
    expect(JSON.stringify(report)).not.toContain(other);
    expect(
      (
        await call(
          `/api/internal/teams/${team}/storage/download?key=${encodeURIComponent(`${scopePrefix(other)}private.glb`)}`,
        )
      ).status,
    ).toBe(404);
  });

  it("marks recent asset files removable and orders their group by the most recent physical save", async () => {
    const team = newTeamId();
    const prefix = scopePrefix(team);
    const now = Date.now();
    const old = storageRetentionCutoff(now) - 86_400_000;
    await createDb(bindings.PIT_DB)
      .insert(scopeAssets)
      .values(
        withTeam(team, {
          name: "Robot_Test",
          files: JSON.stringify([
            { name: "config.json", size: 2 },
            { name: "model.glb", size: 5 },
          ]),
          config: "{}",
          size: 7,
          uploadedBy: "admin",
          uploadedAt: old,
        }),
      );
    const LOGS = {
      list: async () => ({
        truncated: false,
        objects: [
          { key: `${prefix}Robot_Test/config.json`, size: 2, uploaded: new Date(old) },
          { key: `${prefix}Robot_Test/model.glb`, size: 3, uploaded: new Date(now) },
        ],
      }),
    } as R2Bucket;
    const report = await pitStorageReport({ ...bindings, LOGS }, team);
    const assets = report.allowances.find((a) => a.id === "assets");
    expect(assets).toMatchObject({ bytes: 7, count: 1 });
    expect(
      assets?.files.every((f) => f.eligible && f.eligibleAfter === null && f.uploadedAt === now),
    ).toBe(true);
  });
});
