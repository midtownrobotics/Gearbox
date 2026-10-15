import { checkDemoHook } from "@g3/testing/demo";
import { jsonAs } from "@g3/testing/worker";
import { describe, it } from "vitest";

// The public demo's Inventory (roadmap 5.3): the starter setup and a shop's worth of entries.

describe("the demo's sample data", () => {
  it("loads, reloads after a reset, and is only for the demo team", async () => {
    await checkDemoHook(async ({ student }) => {
      const { items } = await jsonAs<{ items: unknown[] }>(student, "/inventory");
      return items.length;
    });
  });
});
