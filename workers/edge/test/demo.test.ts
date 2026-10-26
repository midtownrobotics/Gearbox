import { demoTeamId } from "@g3/site-config";
import { checkDemoHook } from "@g3/testing/demo";
import { teamUsers } from "@g3/testing/users";
import { call, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// The public demo's Edge (roadmap 5.3): no box, but a month of the network's devices, their use
// and the sites they used.

describe("the demo's sample data", () => {
  it("loads, reloads after a reset, and is only for the demo team", async () => {
    await checkDemoHook(async () => {
      const res = await call(`/internal/teams/${demoTeamId}/export`);
      const { tables } = (await res.json()) as { tables: { net_usage_hourly?: unknown[] } };
      return tables.net_usage_hourly?.length ?? 0;
    });
  });

  it("has the sites each device used, for the top sites", async () => {
    await call(`/internal/teams/${demoTeamId}`, { method: "DELETE" });
    await call(`/internal/teams/${demoTeamId}/demo`, { method: "POST" });
    const day = (daysAgo: number) =>
      new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { sites } = await jsonAs<{ sites: { site: string }[] }>(
      teamUsers(demoTeamId).admin,
      `/network/sites?from=${day(29)}&to=${day(0)}`,
    );
    expect(sites.map((s) => s.site)).toContain("cad.onshape.com");
  });
});
