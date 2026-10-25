import { env } from "cloudflare:workers";
import { inTeam, withTeam } from "@g3/auth";
import { newTeamId, teamUsers, testUser } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import {
  scoutingFormSubmissions,
  scoutingForms,
  scoutingMatchAssignments,
  strategyEventConfig,
  strategyPresence,
} from "../src/db/schema";
import { assignmentCandidates } from "../src/scout-assignments";
import type { AppEnv } from "../src/types";
import { seedManualMatch } from "./manual-match";

const bindings = env as unknown as AppEnv["Bindings"];
const db = createDb(bindings.SCOUTING_DB);
const robots = ["9999", "102", "103", "104", "105", "106"];
type Coverage = {
  currentMatchKey: string;
  forms: { id: string; name: string }[];
  matches: {
    key: string;
    teams: { team: string; assignedScouts: number; forms: { id: string; reports: number }[] }[];
  }[];
};
async function fixture() {
  const team = teamUsers(newTeamId());
  const eventKey = `manual-${crypto.randomUUID()}`;
  for (const number of [1, 2])
    await seedManualMatch(bindings.SCOUTING_DB, team.teamId, eventKey, number, team.admin.id);
  await db.insert(strategyEventConfig).values(
    withTeam(team.teamId, {
      id: 1,
      event_key: eventKey,
      current_match_number: 1,
      schedule_mode: "manual",
      updated_by: team.admin.id,
      updated_at: Date.now(),
    }),
  );
  const create = async (name: string) =>
    (
      await jsonAs<{ id: string }>(
        team.admin,
        "/scouting/scouting-forms",
        {
          method: "POST",
          body: { name, fields: [{ id: "score", label: "Score", type: "counter" }] },
        },
        201,
      )
    ).id;
  const context = (user = team.student) =>
    jsonAs<{ assignedTeam: string }>(user, "/scouting/event-context?assign=true");
  await jsonAs(team.admin, "/scouting/scouting-forms");
  const claim = (userId: string, robot: string, at = Date.now() - 600_000) =>
    db.insert(scoutingMatchAssignments).values(
      withTeam(team.teamId, {
        event_key: eventKey,
        match_number: 1,
        user_id: userId,
        team_number: robot,
        assigned_at: at,
      }),
    );
  const report = (formId: string, robot: string, userId: string, extra = {}) =>
    db.insert(scoutingFormSubmissions).values(
      withTeam(team.teamId, {
        id: crypto.randomUUID(),
        form_id: formId,
        answers_json: "{}",
        submitted_by: userId,
        submitted_by_name: "Scout",
        created_at: Date.now(),
        team_name: robot,
        event_key: eventKey,
        match_key: `${eventKey}_qm1`,
        match_number: 1,
        ...extra,
      }),
    );
  return { team, eventKey, create, context, claim, report };
}

describe("missing match reports", () => {
  it("compares all six robots against every active form without counting duplicates, pit, archived or other-event reports as completion", async () => {
    const f = await fixture();
    const first = await f.create("Scoring");
    const second = await f.create("Defense");
    const inactive = await f.create("Old form");
    // Seed placeholders are empty and should not generate missing-report obligations.
    await db
      .update(scoutingForms)
      .set({ is_active: 0 })
      .where(inTeam(scoutingForms, f.team.teamId, sql`id = ${inactive}`));
    await f.report(first, "9999", "a");
    await f.report(first, "9999", "b");
    await f.report(first, "102", "c", { event_key: "another-event" });
    await f.report(first, "103", "d", { archived_at: Date.now() });
    await f.report(second, "104", "e", { submitted_late: 1 });
    await f.report(inactive, "105", "f");
    await f.report("form_pit_scouting", "106", "pit-scout");
    const result = await jsonAs<Coverage>(f.team.admin, "/scouting/match-coverage");
    expect(result.forms.map((form) => form.id).sort()).toEqual([first, second].sort());
    expect(result.currentMatchKey).toBe(`${f.eventKey}_qm1`);
    expect(result.matches[0].teams).toHaveLength(6);
    const team = (number: string) => result.matches[0].teams.find((row) => row.team === number);
    expect(team("9999")?.forms.find((form) => form.id === first)?.reports).toBe(2);
    expect(team("9999")?.forms.find((form) => form.id === second)?.reports).toBe(0);
    expect(team("102")?.forms.every((form) => form.reports === 0)).toBe(true);
    expect(team("103")?.forms.every((form) => form.reports === 0)).toBe(true);
    expect(team("104")?.forms.find((form) => form.id === second)?.reports).toBe(1);
    expect(
      result.matches[1].teams.every((row) => row.forms.every((form) => form.reports === 0)),
    ).toBe(true);
  });

  it("requires a strategy lead and isolates the configured event and organization", async () => {
    const a = await fixture();
    const b = await fixture();
    const form = await a.create("Private form");
    await a.report(form, "9999", a.team.student.id);
    expect((await callAs(a.team.student, "/scouting/match-coverage")).status).toBe(403);
    const result = await jsonAs<Coverage>(b.team.admin, "/scouting/match-coverage");
    expect(result.forms.map((row) => row.id)).not.toContain(form);
    expect(result.matches.map((row) => row.key)).not.toContain(`${a.eventKey}_qm1`);
  });
});

describe("balanced robot assignments", () => {
  it("covers all six before duplicating under concurrent requests and keeps retries stable", async () => {
    const f = await fixture();
    const users = Array.from({ length: 13 }, (_, index) =>
      testUser({ id: `scout-${index}`, teamId: f.team.teamId }),
    );
    const assigned = await Promise.all(users.map((user) => f.context(user)));
    const counts = robots.map(
      (robot) => assigned.filter((row) => row.assignedTeam === robot).length,
    );
    expect(Math.max(...counts) - Math.min(...counts)).toBe(1);
    expect(Math.min(...counts)).toBe(2);
    expect((await f.context(users[0])).assignedTeam).toBe(assigned[0].assignedTeam);
  });

  it("discounts abandoned claims while preserving work from departed scouts", async () => {
    const f = await fixture();
    await f.claim("departed", "9999");
    expect((await f.context()).assignedTeam).toBe("9999");
    const g = await fixture();
    const form = await g.create("Match");
    await g.claim("submitted", "9999");
    await g.report(form, "9999", "submitted");
    expect((await g.context()).assignedTeam).toBe("104");
    const h = await fixture();
    const historical = await h.create("Imported match report");
    await h.report(historical, "9999", "imported-scout");
    expect((await h.context()).assignedTeam).toBe("104");
  });

  it("counts online scouts even after their initial claim ages, and never rewrites their valid assignment", async () => {
    const f = await fixture();
    await f.claim(f.team.otherStudent.id, "9999");
    await db.insert(strategyPresence).values(
      withTeam(f.team.teamId, {
        user_id: f.team.otherStudent.id,
        display_name: "Scout",
        is_admin: 0,
        current_page: "forms",
        last_seen_at: Date.now(),
      }),
    );
    expect((await f.context()).assignedTeam).toBe("104");
    expect((await f.context(f.team.otherStudent)).assignedTeam).toBe("9999");
    const rows = await db
      .select()
      .from(scoutingMatchAssignments)
      .where(inTeam(scoutingMatchAssignments, f.team.teamId));
    expect(rows.find((row) => row.user_id === f.team.otherStudent.id)?.assigned_at).toBeLessThan(
      Date.now() - 500_000,
    );
  });

  it("interleaves alliances and rotates equal-coverage choices across matches", () => {
    expect(assignmentCandidates(robots, 1)).toEqual(["9999", "104", "102", "105", "103", "106"]);
    expect(
      new Set(Array.from({ length: 6 }, (_, index) => assignmentCandidates(robots, index + 1)[0]))
        .size,
    ).toBe(6);
    expect(assignmentCandidates([], 1)).toEqual([]);
  });
});
