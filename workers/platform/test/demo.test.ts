import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { demoTeamId } from "@g3/demo";
import { site } from "@g3/site-config";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notifications } from "../src/db/schema";
import { maybeResetDemo, resetDemo } from "../src/demo";
import { db } from "../src/lib";
import type { AppEnv } from "../src/types";

// The public demo's reset (roadmap 5.4): the hourly cron wipes the demo team in every app and
// loads its sample data again at midnight in its time zone. The apps are stubs that record what
// they were asked (vitest.config.mts).

const testEnv = env as unknown as AppEnv["Bindings"];
const call = (path: string, init: RequestInit = {}) =>
  exports.default.fetch(new Request(`http://platform/api${path}`, init));

/** How many times an app was asked to delete, and to load sample data, for the demo team. */
async function asked(binding: "ORDERS" | "SKILL_TREE") {
  const list = async (what: string) =>
    (await (await testEnv[binding].fetch(`http://x/api/internal/${what}`)).json()) as string[];
  const count = (ids: string[]) => ids.filter((id) => id === demoTeamId).length;
  return { deleted: count(await list("deleted")), demoed: count(await list("demoed")) };
}

describe("the public demo", () => {
  it("can't be signed up or reported", async () => {
    const signup = await call("/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamNumber: site.demo.teamNumber,
        name: "Not the demo",
        country: "US",
        acceptTerms: true,
        acceptBeta: true,
      }),
    });
    expect(signup.status).toBe(400);
    const report = await call("/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamNumber: site.demo.teamNumber,
        email: "someone@example.org",
        message: "This isn't a real team.",
      }),
    });
    expect(report.status).toBe(400);
  });

  it("is made on the first hourly run, whatever the hour, with every app on", async () => {
    const before = await asked("ORDERS");
    // Noon in New York: not the reset's hour, but there's no demo team yet.
    await maybeResetDemo(testEnv, new Date("2026-07-01T16:00:00Z"));
    const after = await asked("ORDERS");
    expect(after.deleted).toBe(before.deleted + 1);
    expect(after.demoed).toBe(before.demoed + 1);

    const team = (await (await call(`/teams/${demoTeamId}`)).json()) as { apps: string[] };
    expect(team.apps).toEqual(
      expect.arrayContaining(["orders", "skillTree", "schedule", "scouting"]),
    );
  });

  it("is reset only at midnight Eastern once it exists, in summer and winter", async () => {
    await maybeResetDemo(testEnv, new Date("2026-07-01T16:00:00Z"));
    const start = await asked("SKILL_TREE");
    const runs = [
      "2026-07-01T16:00:00Z", // noon EDT
      "2026-07-02T03:00:00Z", // 11 PM EDT
      "2026-07-02T04:00:00Z", // midnight EDT: reset
      "2026-07-02T05:00:00Z", // 1 AM EDT
      "2026-12-02T04:00:00Z", // 11 PM EST
      "2026-12-02T05:00:00Z", // midnight EST: reset
    ];
    for (const at of runs) await maybeResetDemo(testEnv, new Date(at));
    const end = await asked("SKILL_TREE");
    expect(end.deleted - start.deleted).toBe(2);
    expect(end.demoed - start.demoed).toBe(2);
  });

  it("can be reset by hand (local dev), the gateway never answers it", async () => {
    const res = await call("/internal/demo/reset", { method: "POST" });
    expect(await res.json()).toEqual({ failed: [] });
  });

  it("has one notification from its admin, however many visitors wrote", async () => {
    await resetDemo(testEnv);
    await resetDemo(testEnv);
    const rows = await db(testEnv)
      .select()
      .from(notifications)
      .where(eq(notifications.teamId, demoTeamId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("info");
  });
});
