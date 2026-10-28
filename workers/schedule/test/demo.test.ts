import { env } from "cloudflare:workers";
import { inTeam } from "@g3/auth";
import { visitorFor } from "@g3/demo";
import { demoTeamId } from "@g3/site-config";
import { checkDemoHook } from "@g3/testing/demo";
import { call } from "@g3/testing/worker";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { friends } from "../src/db/schema";
import type { AppEnv } from "../src/types";

// The public demo's Schedule (roadmap 5.3): roles and a published event with everyone painted in,
// and friends for the accounts visitors use.

describe("the demo's sample data", () => {
  it("loads, reloads after a reset, and is only for the demo team", async () => {
    await checkDemoHook(async () => {
      const res = await call(`/internal/teams/${demoTeamId}/export`);
      const { tables } = (await res.json()) as { tables: { assignments?: unknown[] } };
      return tables.assignments?.length ?? 0;
    });
  });

  it("gives each visitor account a few friends", async () => {
    await call(`/internal/teams/${demoTeamId}`, { method: "DELETE" });
    await call(`/internal/teams/${demoTeamId}/demo`, { method: "POST" });
    const db = createDb((env as unknown as AppEnv["Bindings"]).SCHEDULE_DB);
    for (const role of ["student", "mentor", "admin"] as const) {
      const rows = await db
        .select()
        .from(friends)
        .where(inTeam(friends, demoTeamId, eq(friends.userId, visitorFor(role).id)))
        .all();
      expect(rows.length).toBeGreaterThan(1);
    }
  });
});
