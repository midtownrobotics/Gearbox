import { demoTeamId } from "@g3/site-config";
import { checkDemoHook } from "@g3/testing/demo";
import { call } from "@g3/testing/worker";
import { describe, it } from "vitest";

// The public demo's Schedule (roadmap 5.3): roles and a published event with everyone painted in.

describe("the demo's sample data", () => {
  it("loads, reloads after a reset, and is only for the demo team", async () => {
    await checkDemoHook(async () => {
      const res = await call(`/internal/teams/${demoTeamId}/export`);
      const { tables } = (await res.json()) as { tables: { assignments?: unknown[] } };
      return tables.assignments?.length ?? 0;
    });
  });
});
