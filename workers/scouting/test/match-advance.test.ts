import { env } from "cloudflare:workers";
import { inTeam, withTeam } from "@g3/auth";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import {
  scoutingFormSubmissions,
  strategyAdmins,
  strategyEventConfig,
  tbaMatchCache,
} from "../src/db/schema";
import { automaticTbaMatch } from "../src/match-advance";
import type { AppEnv, TbaMatch } from "../src/types";

const db = createDb((env as unknown as AppEnv["Bindings"]).SCOUTING_DB);
const now = 2000000000;
function matches(endedAt: number): TbaMatch[] {
  return [1, 2].map((number) => ({
    key: `qa_qm${number}`,
    comp_level: "qm",
    set_number: 1,
    match_number: number,
    time: endedAt - 150 + (number - 1) * 600,
    predicted_time: null,
    actual_time: number === 1 ? endedAt - 150 : null,
    post_result_time: number === 1 ? endedAt : null,
    alliances: {
      red: { team_keys: ["frc101", "frc102", "frc103"], score: number === 1 ? 100 : -1 },
      blue: { team_keys: ["frc104", "frc105", "frc106"], score: number === 1 ? 90 : -1 },
    },
  }));
}
type EventContext = {
  currentMatch: { key: string; matchNumber: number } | null;
  assignedTeam: string | null;
  submissionClosesAt: number | null;
  submissionWindowSeconds: number | null;
};
type Settings = { values: { submissionWindowSeconds: number } };

async function eventTeam() {
  const team = teamUsers(newTeamId());
  const eventKey = `2099qa${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
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
    matches_json: JSON.stringify(matches(Math.floor(Date.now() / 1000) - 90)),
    expires_at: Date.now() + 600000,
  });
  return { ...team, eventKey };
}

describe("automatic match advancing", () => {
  it("waits two minutes by default and advances at the boundary", () => {
    const schedule = matches(now);
    expect(automaticTbaMatch(schedule, undefined, now + 60)?.match_number).toBe(1);
    expect(automaticTbaMatch(schedule, undefined, now + 119)?.match_number).toBe(1);
    expect(automaticTbaMatch(schedule, undefined, now + 120)?.match_number).toBe(2);
  });

  it("honors longer delays and zero without advancing an unfinished match", () => {
    const schedule = matches(now);
    expect(automaticTbaMatch(schedule, 37, now + 36)?.match_number).toBe(1);
    expect(automaticTbaMatch(schedule, 37, now + 37)?.match_number).toBe(2);
    expect(automaticTbaMatch(schedule, 300, now + 299)?.match_number).toBe(1);
    expect(automaticTbaMatch(schedule, 300, now + 300)?.match_number).toBe(2);
    expect(automaticTbaMatch(schedule, 0, now)?.match_number).toBe(2);
    schedule[0].post_result_time = null;
    schedule[0].actual_time = null;
    schedule[0].alliances.red.score = -1;
    schedule[0].alliances.blue.score = -1;
    expect(automaticTbaMatch(schedule, 0, now + 10000)?.match_number).toBe(1);
    expect(automaticTbaMatch([], 120, now)).toBeUndefined();
  });

  it("uses actual match duration or scored schedule timing when result time is absent", () => {
    const schedule = matches(now);
    schedule[0].post_result_time = null;
    expect(automaticTbaMatch(schedule, 120, now + 119)?.match_number).toBe(1);
    expect(automaticTbaMatch(schedule, 120, now + 120)?.match_number).toBe(2);
    schedule[0].actual_time = null;
    expect(automaticTbaMatch(schedule, 120, now + 120)?.match_number).toBe(2);
  });

  it("persists the Admin setting per team and applies it to automatic match selection", async () => {
    const a = await eventTeam();
    const b = await eventTeam();
    expect(await jsonAs<EventContext>(a.admin, "/scouting/event-context")).toMatchObject({
      submissionWindowSeconds: 120,
      currentMatch: { matchNumber: 1 },
    });
    await jsonAs(a.admin, "/scouting/event-context", {
      method: "PUT",
      body: { eventKey: a.eventKey, currentMatchNumber: 1, submissionWindowSeconds: 60 },
    });
    expect(await jsonAs<EventContext>(a.student, "/scouting/event-context")).toMatchObject({
      submissionWindowSeconds: 60,
      currentMatch: { matchNumber: 2 },
    });
    expect(await jsonAs<EventContext>(b.admin, "/scouting/event-context")).toMatchObject({
      submissionWindowSeconds: 120,
      currentMatch: { matchNumber: 1 },
    });
    await jsonAs(a.admin, "/scouting/event-context", {
      method: "PUT",
      body: { eventKey: a.eventKey, currentMatchNumber: 2 },
    });
    expect(
      (await jsonAs<EventContext>(a.admin, "/scouting/event-context")).submissionWindowSeconds,
    ).toBe(60);
  });

  it("rejects invalid delays and unauthorized changes", async () => {
    const team = await eventTeam();
    const body = { eventKey: team.eventKey, currentMatchNumber: 1, submissionWindowSeconds: 180 };
    for (const user of [team.student, team.kioskAdmin])
      expect((await callAs(user, "/scouting/event-context", { method: "PUT", body })).status).toBe(
        403,
      );
    for (const value of [-1, 1801, 1.5, null, true, "invalid"])
      expect(
        (
          await callAs(team.admin, "/scouting/event-context", {
            method: "PUT",
            body: { ...body, submissionWindowSeconds: value },
          })
        ).status,
      ).toBe(400);
    expect(
      (await jsonAs<EventContext>(team.admin, "/scouting/event-context")).submissionWindowSeconds,
    ).toBe(120);
    await db.insert(strategyAdmins).values(
      withTeam(team.teamId, {
        user_id: team.student.id,
        display_name: team.student.displayName,
        email: team.student.email,
        granted_by: team.admin.id,
        created_at: Date.now(),
      }),
    );
    expect(
      (await callAs(team.student, "/scouting/event-context", { method: "PUT", body })).status,
    ).toBe(200);
  });

  it("uses the same delay for scout assignments and submitted report match links", async () => {
    const team = await eventTeam();
    await jsonAs(team.admin, "/scouting/event-context", {
      method: "PUT",
      body: { eventKey: team.eventKey, currentMatchNumber: 1, submissionWindowSeconds: 300 },
    });
    const { id } = await jsonAs<{ id: string }>(
      team.admin,
      "/scouting/scouting-forms",
      {
        method: "POST",
        body: { name: "Match test", fields: [{ id: "auto", label: "Auto", type: "counter" }] },
      },
      201,
    );
    const context = await jsonAs<EventContext>(team.student, "/scouting/event-context?assign=true");
    expect(context.currentMatch?.matchNumber).toBe(1);
    const body = new FormData();
    body.set("matchKey", context.currentMatch?.key ?? "");
    body.set("teamName", context.assignedTeam ?? "");
    body.set("answers", JSON.stringify({ auto: 5 }));
    expect(
      (
        await callAs(team.student, `/scouting/scouting-forms/${id}/submissions`, {
          method: "POST",
          body,
        })
      ).status,
    ).toBe(201);
    expect(
      await db
        .select({ matchNumber: scoutingFormSubmissions.match_number })
        .from(scoutingFormSubmissions)
        .where(inTeam(scoutingFormSubmissions, team.teamId))
        .get(),
    ).toEqual({ matchNumber: 1 });
  });

  it("keeps manual schedule selection independent of the automatic delay", async () => {
    const team = await eventTeam();
    await jsonAs(team.admin, "/scouting/event-context", {
      method: "PUT",
      body: { eventKey: team.eventKey, currentMatchNumber: 1, submissionWindowSeconds: 0 },
    });
    await jsonAs(team.admin, "/scouting/manual-mode", {
      method: "POST",
      body: { eventName: "Manual Test", endsAt: Date.now() + 86400000 },
    });
    await jsonAs(team.admin, "/scouting/manual-schedule", {
      method: "PUT",
      body: {
        matches: [1, 2].map((matchNumber) => ({
          matchNumber,
          scheduledAt: Date.now() - 3600000,
          teams: ["101", "102", "103", "104", "105", "106"],
        })),
      },
    });
    await jsonAs(team.admin, "/scouting/event-context", {
      method: "PUT",
      body: { currentMatchNumber: 1 },
    });
    expect(await jsonAs<EventContext>(team.admin, "/scouting/event-context")).toMatchObject({
      currentMatch: { matchNumber: 1 },
      submissionWindowSeconds: 0,
    });
  });

  it("exposes the same setting through the manifest-backed settings API", async () => {
    const team = await eventTeam();
    expect(
      (await jsonAs<Settings>(team.admin, "/team-settings")).values.submissionWindowSeconds,
    ).toBe(120);
    await jsonAs(team.admin, "/team-settings", {
      method: "PUT",
      body: { values: { submissionWindowSeconds: 300 } },
    });
    expect(
      (await jsonAs<EventContext>(team.admin, "/scouting/event-context")).submissionWindowSeconds,
    ).toBe(300);
    expect(
      (
        await callAs(team.admin, "/team-settings", {
          method: "PUT",
          body: { values: { submissionWindowSeconds: 1.5 } },
        })
      ).status,
    ).toBe(400);
  });

  it("supports a previously loaded minutes editor and preserves precise second values", async () => {
    const team = await eventTeam();
    await jsonAs(team.admin, "/scouting/event-context", {
      method: "PUT",
      body: { eventKey: team.eventKey, autoAdvanceDelayMinutes: 5 },
    });
    expect(await jsonAs(team.admin, "/scouting/event-context")).toMatchObject({
      submissionWindowSeconds: 300,
      autoAdvanceDelayMinutes: 5,
    });
    await jsonAs(team.admin, "/scouting/event-context", {
      method: "PUT",
      body: { eventKey: team.eventKey, submissionWindowSeconds: 75 },
    });
    expect(await jsonAs(team.admin, "/scouting/event-context")).toMatchObject({
      submissionWindowSeconds: 75,
      autoAdvanceDelayMinutes: 1.25,
    });
  });
});
