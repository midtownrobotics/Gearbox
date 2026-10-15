import { demoTeamId } from "@g3/site-config";
import { checkDemoHook } from "@g3/testing/demo";
import { call } from "@g3/testing/worker";
import { describe, it } from "vitest";

// The public demo's Scouting (roadmap 5.3): an event in progress with a schedule entered by
// hand, reports from the first matches, a pick list and assignments for the next ones.

describe("the demo's sample data", () => {
  it("loads, reloads after a reset, and is only for the demo team", async () => {
    await checkDemoHook(async () => {
      const res = await call(`/internal/teams/${demoTeamId}/export`);
      const { tables } = (await res.json()) as {
        tables: { scouting_form_submissions?: unknown[]; manual_matches?: unknown[] };
      };
      return (tables.scouting_form_submissions?.length ?? 0) + (tables.manual_matches?.length ?? 0);
    });
  });
});
