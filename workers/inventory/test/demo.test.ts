import { demoTeamId } from "@g3/site-config";
import { checkDemoHook } from "@g3/testing/demo";
import { teamUsers } from "@g3/testing/users";
import { call, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// The public demo's Inventory (roadmap 5.3): the starter setup, with descriptions on a few
// locations, and a shop's worth of entries.

describe("the demo's sample data", () => {
  it("loads, reloads after a reset, and is only for the demo team", async () => {
    await checkDemoHook(async ({ student }) => {
      const { items } = await jsonAs<{ items: unknown[] }>(student, "/inventory");
      return items.length;
    });
  });

  it("describes what's kept in a few locations", async () => {
    await call(`/internal/teams/${demoTeamId}`, { method: "DELETE" });
    await call(`/internal/teams/${demoTeamId}/demo`, { method: "POST" });
    const { locations } = await jsonAs<{ locations: { name: string; title: string }[] }>(
      teamUsers(demoTeamId).student,
      "/options",
    );
    expect(locations.find((l) => l.name === "Shelves")?.title).toBe("Spare hardware");
  });
});
