import { demoTeamId } from "@g3/site-config";
import { checkDemoHook } from "@g3/testing/demo";
import { call } from "@g3/testing/worker";
import { describe, it } from "vitest";

// The public demo's Skill Tree (roadmap 5.3): the default trees, with students partway through.
// The test's G3ID doesn't know the demo's people, so progress is counted from the team's export.

describe("the demo's sample data", () => {
  it("loads, reloads after a reset, and is only for the demo team", async () => {
    await checkDemoHook(async () => {
      const res = await call(`/internal/teams/${demoTeamId}/export`);
      const { tables } = (await res.json()) as { tables: { skill_progress?: unknown[] } };
      return tables.skill_progress?.length ?? 0;
    });
  });
});
