import { checkDemoHook } from "@g3/testing/demo";
import { jsonAs } from "@g3/testing/worker";
import { describe, it } from "vitest";

// The public demo's Pit (roadmap 5.3): checklists partway done, open issues and batteries.

describe("the demo's sample data", () => {
  it("loads, reloads after a reset, and is only for the demo team", async () => {
    await checkDemoHook(async ({ student }) => {
      const lists = await jsonAs<unknown[]>(student, "/lists");
      return lists.length;
    });
  });
});
