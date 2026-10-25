import { env } from "cloudflare:workers";
import { inTeam, withTeam } from "@g3/auth";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import {
  manualTeams,
  scoutingFormSubmissions,
  scoutingForms,
  strategyEventConfig,
  tbaMatchCache,
} from "../src/db/schema";
import type { AppEnv, TbaMatch } from "../src/types";
import { seedManualMatch } from "./manual-match";

const bindings = env as unknown as AppEnv["Bindings"];
const db = createDb(bindings.SCOUTING_DB);
const counter = { id: "score", label: "Score", type: "counter" };

async function fixture() {
  const team = teamUsers(newTeamId());
  const eventKey = `2099qa${crypto.randomUUID().replaceAll("-", "")}`;
  const matches: TbaMatch[] = [1, 2].map((number) => ({
    key: `${eventKey}_qm${number}`,
    comp_level: "qm",
    set_number: 1,
    match_number: number,
    time: null,
    predicted_time: null,
    actual_time: null,
    post_result_time: number === 1 ? Math.floor(Date.now() / 1000) - 10 : null,
    alliances: {
      red: { team_keys: ["frc101", "frc102", "frc103"], score: number === 1 ? 20 : -1 },
      blue: { team_keys: ["frc104", "frc105", "frc106"], score: number === 1 ? 10 : -1 },
    },
  }));
  await db.insert(strategyEventConfig).values(
    withTeam(team.teamId, {
      id: 1,
      event_key: eventKey,
      current_match_number: 1,
      updated_by: team.admin.id,
      updated_at: Date.now(),
    }),
  );
  await db.insert(tbaMatchCache).values({
    event_key: eventKey,
    matches_json: JSON.stringify(matches),
    expires_at: Date.now() + 600_000,
  });
  await jsonAs(team.admin, "/scouting/scouting-forms");
  return { team, eventKey, matches };
}

async function createForm(
  user: ReturnType<typeof teamUsers>["admin"],
  name: string,
  kind = "scouting",
  fields: unknown[] = [counter],
  isActive = true,
) {
  return (
    await jsonAs<{ id: string }>(
      user,
      "/scouting/scouting-forms",
      { method: "POST", body: { name, kind, fields, isActive } },
      201,
    )
  ).id;
}

describe("planned scouting workflows", () => {
  it("retains names, pit kind and inactive state, with mutation permissions", async () => {
    const { team } = await fixture();
    const id = await createForm(team.admin, "Drive interview", "pit", [counter], false);
    const change = { name: "Pit interview", fields: [counter] };
    expect(
      (
        await callAs(team.student, `/scouting/scouting-forms/${id}`, {
          method: "PUT",
          body: change,
        })
      ).status,
    ).toBe(403);
    await jsonAs(team.admin, `/scouting/scouting-forms/${id}`, { method: "PUT", body: change });
    const { forms } = await jsonAs<{
      forms: { id: string; name: string; kind: string; isActive: boolean }[];
    }>(team.admin, "/scouting/scouting-forms");
    expect(forms.find((form) => form.id === id)).toMatchObject({
      name: "Pit interview",
      kind: "pit",
      isActive: false,
    });
    expect(
      (
        await callAs(team.student, `/scouting/scouting-forms/${id}/submissions`, {
          method: "POST",
          body: new FormData(),
        })
      ).status,
    ).toBe(404);
  });

  it("waits for every active form before advancing, while rejecting duplicate submissions atomically", async () => {
    const { team, matches } = await fixture();
    const first = await createForm(team.admin, "Scoring");
    const second = await createForm(team.admin, "Auto", "scouting", [
      { id: "path", label: "Auto path", type: "fieldMap" },
    ]);
    await createForm(team.admin, "Inactive", "scouting", [counter], false);
    type Context = {
      currentMatch: { key: string };
      assignedTeam: string;
      submittedFormIds: string[];
    };
    const context = () => jsonAs<Context>(team.student, "/scouting/event-context?assign=true");
    const before = await context();
    const submit = (formId: string, answers: object, upload = false) => {
      const body = new FormData();
      body.set("teamName", before.assignedTeam);
      body.set("matchKey", before.currentMatch.key);
      body.set("answers", JSON.stringify(answers));
      if (upload) body.set("drawing:path", new File(["image"], "path.png", { type: "image/png" }));
      return callAs(team.student, `/scouting/scouting-forms/${formId}/submissions`, {
        method: "POST",
        body,
      });
    };
    expect((await submit(first, { score: 0 })).status).toBe(201);
    const partial = await context();
    expect(partial.currentMatch.key).toBe(matches[0].key);
    expect(partial.submittedFormIds).toEqual([first]);
    expect((await submit(first, { score: 2 })).status).toBe(409);
    expect((await submit(second, {})).status).toBe(400);
    expect((await submit(second, { path: "invalid" })).status).toBe(400);
    expect((await submit(second, { path: "no-minimal-movement" }, true)).status).toBe(400);
    expect((await submit(second, { path: "no-minimal-movement" })).status).toBe(201);
    expect((await context()).currentMatch.key).toBe(matches[1].key);
    const { reports } = await jsonAs<{ reports: { answers: object; drawings: object }[] }>(
      team.student,
      `/scouting/analysis?matchKey=${matches[0].key}`,
    );
    expect(reports).toHaveLength(2);
    expect(reports.find((report) => "path" in report.answers)).toMatchObject({
      answers: { path: "no-minimal-movement" },
      drawings: {},
    });
    const duplicate = await db
      .select()
      .from(scoutingFormSubmissions)
      .where(inTeam(scoutingFormSubmissions, team.teamId))
      .get();
    if (!duplicate) throw new Error("Missing submitted report");
    await expect(
      db.insert(scoutingFormSubmissions).values({ ...duplicate, id: crypto.randomUUID() }),
    ).rejects.toThrow();
  });

  it("loads a match across all its teams, scoped to the signed-in organization", async () => {
    const { team, eventKey, matches } = await fixture();
    const other = teamUsers(newTeamId());
    const id = await createForm(team.admin, "Scoring");
    for (const [number, match] of [
      ["101", matches[0]],
      ["104", matches[0]],
      ["102", matches[1]],
    ] as const) {
      await db.insert(scoutingFormSubmissions).values(
        withTeam(team.teamId, {
          id: crypto.randomUUID(),
          form_id: id,
          answers_json: '{"score":3}',
          submitted_by: number,
          submitted_by_name: "Scout",
          created_at: Date.now(),
          team_name: number,
          event_key: eventKey,
          match_key: match.key,
          match_number: match.match_number,
        }),
      );
    }
    const result = await jsonAs<{
      reports: { teamName: string }[];
      teamMatches: { key: string }[];
    }>(team.student, "/scouting/analysis");
    expect(result.teamMatches.map((match) => match.key)).toEqual(matches.map((match) => match.key));
    const selected = await jsonAs<{ reports: { teamName: string }[] }>(
      team.student,
      `/scouting/analysis?matchKey=${matches[0].key}`,
    );
    expect(selected.reports.map((report) => report.teamName).sort()).toEqual(["101", "104"]);
    expect(
      (
        await jsonAs<{ reports: unknown[] }>(
          other.student,
          `/scouting/analysis?matchKey=${matches[0].key}`,
        )
      ).reports,
    ).toEqual([]);
  });

  it("stores every service category and isolates tickets", async () => {
    const { team } = await fixture();
    const other = teamUsers(newTeamId());
    for (const issueTypes of [["invalid"], "mechanical", ["electrical", 3]]) {
      expect(
        (
          await callAs(team.student, "/scouting/service-tickets", {
            method: "POST",
            body: { teamName: "101", issueTypes },
          })
        ).status,
      ).toBe(400);
    }
    for (const categories of [
      { issueTypes: ["mechanical", "electrical"] },
      { issueTypes: ["programming"] },
    ]) {
      expect(
        (
          await callAs(team.student, "/scouting/service-tickets", {
            method: "POST",
            body: { teamName: "101", ...categories },
          })
        ).status,
      ).toBe(201);
    }
    const result = await jsonAs<{ tickets: { issueTypes: string[] }[] }>(
      team.admin,
      "/scouting/operations",
    );
    expect(result.tickets.map((ticket) => ticket.issueTypes)).toEqual(
      expect.arrayContaining([["mechanical", "electrical"], ["programming"]]),
    );
    expect(
      (await jsonAs<{ tickets: unknown[] }>(other.admin, "/scouting/operations")).tickets,
    ).toEqual([]);
  });

  it("counts only non-archived pit reports for the current event against its full roster", async () => {
    const { team, eventKey } = await fixture();
    await seedManualMatch(bindings.SCOUTING_DB, team.teamId, eventKey, 1, team.admin.id);
    await db
      .update(strategyEventConfig)
      .set({ schedule_mode: "manual" })
      .where(inTeam(strategyEventConfig, team.teamId));
    for (const number of ["101", "102", "103"]) {
      await db.insert(manualTeams).values(
        withTeam(team.teamId, {
          event_key: eventKey,
          team_number: number,
          team_name: `Team ${number}`,
        }),
      );
    }
    const id = await createForm(team.admin, "Pit", "pit");
    for (const [number, event, archived] of [
      ["101", eventKey, false],
      ["101", eventKey, false],
      ["102", "another-event", false],
      ["103", eventKey, true],
    ] as const) {
      await db.insert(scoutingFormSubmissions).values(
        withTeam(team.teamId, {
          id: crypto.randomUUID(),
          form_id: id,
          answers_json: "{}",
          submitted_by: team.student.id,
          submitted_by_name: "Scout",
          created_at: Date.now(),
          team_name: number,
          event_key: event,
          archived_at: archived ? Date.now() : null,
        }),
      );
    }
    const result = await jsonAs<{
      total: number;
      completed: number;
      remaining: { number: string }[];
    }>(team.student, "/scouting/pit-coverage");
    expect(result).toMatchObject({ total: 3, completed: 1 });
    expect(result.remaining.map((entry) => entry.number)).toEqual(["102", "103"]);
    await db.update(scoutingForms).set({ is_active: 0 }).where(inTeam(scoutingForms, team.teamId));
    expect(
      (await jsonAs<{ completed: number }>(team.student, "/scouting/pit-coverage")).completed,
    ).toBe(1);
    const other = teamUsers(newTeamId());
    expect((await callAs(other.student, "/scouting/pit-coverage")).status).toBe(409);
  });
});
