// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { newTeamId } from "@g3/testing/users";
import { call } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// How much each team keeps in Shop's R2 (drawings and part files), for the operators' console: sizes and counts by team.

const bucket = (env as unknown as { DRAWINGS: R2Bucket }).DRAWINGS;

describe("the storage hook", () => {
  it("adds up each team's files, by team", async () => {
    const a = newTeamId();
    const b = newTeamId();
    const key = (pattern: string, team: string) => pattern.replace("%s", team);
    await bucket.put(key("teams/%s/drawings/P1/A/drawing.pdf", a), "x".repeat(100));
    await bucket.put(key("teams/%s/files/x.step", a), "x".repeat(50));
    await bucket.put(key("teams/%s/drawings/P1/A/drawing.pdf", b), "x".repeat(10));
    const res = await call("/internal/storage");
    expect(res.status).toBe(200);
    const { teams } = (await res.json()) as { teams: Record<string, unknown> };
    expect(teams[a]).toEqual({ bytes: 150, objects: 2 });
    expect(teams[b]).toEqual({ bytes: 10, objects: 1 });
  });
});
