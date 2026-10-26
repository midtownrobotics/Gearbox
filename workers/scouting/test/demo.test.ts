import { demoTeamId } from "@g3/site-config";
import { checkDemoHook } from "@g3/testing/demo";
import { teamUsers } from "@g3/testing/users";
import { call, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// The public demo's Scouting (roadmap 5.3): an event in progress with a schedule entered by
// hand, two visible match forms and a hidden one, reports from the first matches, a pick list and
// assignments for the next ones.

type Forms = { forms: { name: string; kind: string; isActive: boolean }[] };

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

  it("has two visible match forms and a hidden one, which scouts don't get", async () => {
    const { admin, student } = teamUsers(demoTeamId);
    await call(`/internal/teams/${demoTeamId}`, { method: "DELETE" });
    await call(`/internal/teams/${demoTeamId}/demo`, { method: "POST" });
    const all = (await jsonAs<Forms>(admin, "/scouting/scouting-forms")).forms;
    const match = all.filter((form) => form.kind === "scouting");
    expect(match.filter((form) => form.isActive).map((form) => form.name)).toEqual(
      expect.arrayContaining(["Scouting", "Driver ratings"]),
    );
    expect(match.find((form) => form.name === "Practice day")?.isActive).toBe(false);
    const scouts = (await jsonAs<Forms>(student, "/scouting/scouting-forms")).forms;
    expect(scouts.some((form) => form.name === "Practice day")).toBe(false);
    expect(scouts.some((form) => form.name === "Driver ratings")).toBe(true);
  });
});
