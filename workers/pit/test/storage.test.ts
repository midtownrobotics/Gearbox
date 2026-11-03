// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { newTeamId } from "@g3/testing/users";
import { call } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// How much each team keeps in Pit's R2 (match logs and AdvantageScope assets), for the operators' console: sizes and counts by team.

const bucket = (env as unknown as { LOGS: R2Bucket }).LOGS;

describe("the storage hook", () => {
  it("adds up each team's files, by team", async () => {
    const a = newTeamId();
    const b = newTeamId();
    const key = (pattern: string, team: string) => pattern.replace("%s", team);
    await bucket.put(key("pit/teams/%s/logs/ev/a.wpilog.gz", a), "x".repeat(100));
    await bucket.put(key("pit/teams/%s/scope-assets/robot/model.glb", a), "x".repeat(50));
    await bucket.put(key("pit/teams/%s/logs/ev/a.wpilog.gz", b), "x".repeat(10));
    const res = await call("/internal/storage");
    expect(res.status).toBe(200);
    const { teams } = (await res.json()) as { teams: Record<string, unknown> };
    expect(teams[a]).toEqual({ bytes: 150, objects: 2 });
    expect(teams[b]).toEqual({ bytes: 10, objects: 1 });
  });
});
