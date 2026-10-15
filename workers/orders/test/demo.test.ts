import { checkDemoHook } from "@g3/testing/demo";
import { call, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// The public demo's Orders (roadmap 5.3): requests for real catalog parts in every status.

type Request = { status: string; title: string };

describe("the demo's sample data", () => {
  it("loads, reloads after a reset, and is only for the demo team", async () => {
    await checkDemoHook(async ({ mentor }) => {
      const requests = await jsonAs<Request[]>(mentor, "/requests");
      const statuses = new Set(requests.map((r) => r.status));
      for (const status of ["requested", "approved", "ordered", "received"]) {
        expect(statuses).toContain(status);
      }
      return requests.length;
    });
  });

  it("says the catalog's words, so visitors can request any part", async () => {
    const { words } = (await (await call("/internal/demo/words")).json()) as { words: string[] };
    expect(words.length).toBeGreaterThan(100);
  });
});
