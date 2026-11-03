// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { newTeamId } from "@g3/testing/users";
import { call } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// How much each team keeps in Scouting's R2 (field maps and drawings), for the operators' console: sizes and counts by team.

const bucket = (env as unknown as { FIELD_MAPS: R2Bucket }).FIELD_MAPS;

describe("the storage hook", () => {
  it("adds up each team's files, by team", async () => {
    const a = newTeamId();
    const b = newTeamId();
    const key = (pattern: string, team: string) => pattern.replace("%s", encodeURIComponent(team));
    await bucket.put(key("teams/%s/field-maps/m.png", a), "x".repeat(100));
    await bucket.put(key("teams/%s/scouting-submissions/s.png", a), "x".repeat(50));
    await bucket.put(key("teams/%s/field-maps/m.png", b), "x".repeat(10));
    const res = await call("/internal/storage");
    expect(res.status).toBe(200);
    const { teams } = (await res.json()) as { teams: Record<string, unknown> };
    expect(teams[a]).toEqual({ bytes: 150, objects: 2 });
    expect(teams[b]).toEqual({ bytes: 10, objects: 1 });
  });
});
