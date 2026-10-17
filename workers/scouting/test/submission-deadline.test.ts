import { env } from "cloudflare:workers";
import { inTeam, withTeam } from "@g3/auth";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db";
import {
  scoutingFormSubmissions,
  scoutingMatchAssignments,
  strategyEventConfig,
  tbaMatchCache,
} from "../src/db/schema";
import { automaticTbaMatch, matchSubmissionClosesAt } from "../src/match-advance";
import type { AppEnv, TbaMatch } from "../src/types";
import { seedManualMatch } from "./manual-match";

const bindings = env as unknown as AppEnv["Bindings"];
const db = createDb(bindings.SCOUTING_DB);
type Context = {
  currentMatch: { key: string; matchNumber: number } | null;
  assignedTeam: string | null;
  submissionClosesAt: number | null;
  serverNow: number;
  hasSubmittedCurrentMatch: boolean;
};
function match(key: string, number: number, endedAt: number | null): TbaMatch {
  return {
    key,
    comp_level: "qm",
    set_number: 1,
    match_number: number,
    time: null,
    predicted_time: null,
    actual_time: null,
    post_result_time: endedAt,
    alliances: {
      red: { team_keys: ["frc101", "frc102", "frc103"], score: endedAt ? 10 : -1 },
      blue: { team_keys: ["frc104", "frc105", "frc106"], score: endedAt ? 20 : -1 },
    },
  };
}
async function cacheSchedule(eventKey: string, rows: TbaMatch[], expiresAt = Date.now() + 600000) {
  await db
    .insert(tbaMatchCache)
    .values({ event_key: eventKey, matches_json: JSON.stringify(rows), expires_at: expiresAt })
    .onConflictDoUpdate({
      target: tbaMatchCache.event_key,
      set: { matches_json: JSON.stringify(rows), expires_at: expiresAt },
    });
}
async function fixture(manual = false) {
  const team = teamUsers(newTeamId());
  const eventKey = manual
    ? `manual-${crypto.randomUUID()}`
    : `2099qa${crypto.randomUUID().replaceAll("-", "")}`;
  await db.insert(strategyEventConfig).values(
    withTeam(team.teamId, {
      id: 1,
      event_key: eventKey,
      current_match_number: 1,
      schedule_mode: manual ? "manual" : "tba",
      updated_by: team.admin.id,
      updated_at: Date.now(),
    }),
  );
  const keys = [`${eventKey}_qm1`, `${eventKey}_qm2`];
  if (manual)
    for (const number of [1, 2])
      await seedManualMatch(bindings.SCOUTING_DB, team.teamId, eventKey, number, team.admin.id);
  async function schedule(endedAt: number | null, final = false) {
    const rows = [match(keys[0], 1, endedAt), ...(final ? [] : [match(keys[1], 2, null)])];
    await cacheSchedule(eventKey, rows);
  }
  if (!manual) await schedule(Math.floor(Date.now() / 1000) - 30);
  const { id } = await jsonAs<{ id: string }>(
    team.admin,
    "/scouting/scouting-forms",
    {
      method: "POST",
      body: { name: "Deadline test", fields: [{ id: "score", label: "Score", type: "counter" }] },
    },
    201,
  );
  const context = () => jsonAs<Context>(team.student, "/scouting/event-context?assign=true");
  const submit = (snapshot: Partial<Context>, overrideTeam?: string, drawing = false) => {
    const body = new FormData();
    if (snapshot.currentMatch) body.set("matchKey", snapshot.currentMatch.key);
    body.set("teamName", overrideTeam ?? snapshot.assignedTeam ?? "");
    body.set("answers", JSON.stringify({ score: 5 }));
    if (drawing) body.set("drawing", new File(["test-image"], "auto.png", { type: "image/png" }));
    return callAs(team.student, `/scouting/scouting-forms/${id}/submissions`, {
      method: "POST",
      body,
    });
  };
  const reports = () =>
    db
      .select()
      .from(scoutingFormSubmissions)
      .where(inTeam(scoutingFormSubmissions, team.teamId))
      .all();
  return { team, eventKey, keys, schedule, context, submit, reports };
}

describe("scouting submission deadlines", () => {
  it("allows the next report regardless of scheduled start but cannot run through future matches", async () => {
    const f = await fixture();
    const now = Math.floor(Date.now() / 1000);
    const rows = [
      match(f.keys[0], 1, now - 30),
      ...[2, 3].map((number) => ({
        ...match(`${f.eventKey}_qm${number}`, number, null),
        time: now + number * 3600,
      })),
    ];
    await cacheSchedule(f.eventKey, rows);
    expect((await f.submit(await f.context())).status).toBe(201);
    const next = await f.context();
    expect(next.currentMatch?.matchNumber).toBe(2);
    // Start times can be inaccurate; neither the page nor the worker uses a start-time gate.
    expect((await f.submit(next)).status).toBe(201);
    const capped = await f.context();
    expect(capped.currentMatch?.matchNumber).toBe(2);
    expect(capped.hasSubmittedCurrentMatch).toBe(true);
    expect(
      (await f.submit({ ...next, currentMatch: { key: rows[2].key, matchNumber: 3 } })).status,
    ).toBe(409);
    expect((await f.reports()).length).toBe(2);
    // Once the shared match advances, the following form becomes available normally.
    rows[0].post_result_time = now - 121;
    await cacheSchedule(f.eventKey, rows);
    const following = await f.context();
    expect(following.currentMatch?.matchNumber).toBe(3);
    expect(following.hasSubmittedCurrentMatch).toBe(false);
    expect((await f.submit(following)).status).toBe(201);
  });
  it("returns a retryable error during schedule failure and keeps Admin configuration accessible", async () => {
    const f = await fixture();
    const original = await f.context();
    await cacheSchedule(f.eventKey, [], 0);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Temporary TBA failure")));
    try {
      const response = await callAs(f.team.student, "/scouting/event-context?assign=true");
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining("refresh the match schedule"),
      });
      expect((await callAs(f.team.admin, "/scouting/event-context")).status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
    await f.schedule(Math.floor(Date.now() / 1000) - 30);
    expect(await f.context()).toMatchObject({
      currentMatch: original.currentMatch,
      assignedTeam: original.assignedTeam,
    });
    expect((await f.submit(original)).status).toBe(201);
  });
  it("treats a temporarily empty schedule as unavailable instead of clearing an assignment", async () => {
    const f = await fixture();
    await f.context();
    await cacheSchedule(f.eventKey, []);
    expect((await callAs(f.team.student, "/scouting/event-context?assign=true")).status).toBe(503);
  });
  it("uses one exact boundary for the countdown and match advance", () => {
    const first = match("a", 1, 2000000000);
    const next = match("b", 2, null);
    expect(matchSubmissionClosesAt(first)).toBe(2000000120000);
    expect(automaticTbaMatch([first, next], 120, 2000000119)?.key).toBe("a");
    expect(automaticTbaMatch([first, next], 120, 2000000120)?.key).toBe("b");
    expect(matchSubmissionClosesAt(next)).toBeNull();
  });
  it("accepts a current snapshot and saves its exact match and assigned team", async () => {
    const f = await fixture();
    const context = await f.context();
    expect(context.submissionClosesAt).toBeGreaterThan(context.serverNow);
    expect((await f.submit(context)).status).toBe(201);
    expect(await f.reports()).toMatchObject([
      {
        match_key: context.currentMatch?.key,
        team_name: context.assignedTeam,
        answers_json: '{"score":5}',
      },
    ]);
  });
  it("unlocks the next match immediately after submitting, before the shared cutoff", async () => {
    const f = await fixture();
    const first = await f.context();
    expect(first.submissionClosesAt).toBeGreaterThan(first.serverNow);
    // A scheduled future match cannot be submitted before it becomes this scout's form.
    expect(
      (await f.submit({ ...first, currentMatch: { key: f.keys[1], matchNumber: 2 } })).status,
    ).toBe(409);
    expect((await f.submit(first)).status).toBe(201);
    const next = await f.context();
    expect(next.currentMatch?.matchNumber).toBe(2);
    expect(next.assignedTeam).toBeTruthy();
    expect(next.submissionClosesAt).toBeNull();
    expect(next.hasSubmittedCurrentMatch).toBe(false);
    const unfinished = await jsonAs<Context>(
      f.team.otherStudent,
      "/scouting/event-context?assign=true",
    );
    expect(unfinished.currentMatch?.matchNumber).toBe(1);
    expect(unfinished.hasSubmittedCurrentMatch).toBe(false);
    expect(
      (await jsonAs<Context>(f.team.admin, "/scouting/event-context")).currentMatch?.matchNumber,
    ).toBe(1);
    expect((await f.submit(first)).status).toBe(409);
    expect((await f.submit(next)).status).toBe(201);
    expect((await f.reports()).map((report) => report.match_number).sort()).toEqual([1, 2]);
    const finished = await f.context();
    expect(finished.hasSubmittedCurrentMatch).toBe(true);
  });
  it("keeps manual scheduling under the lead's control after submission", async () => {
    const f = await fixture(true);
    const first = await f.context();
    expect((await f.submit(first)).status).toBe(201);
    expect(await f.context()).toMatchObject({
      currentMatch: { matchNumber: 1 },
      hasSubmittedCurrentMatch: true,
    });
  });
  it("rejects an old draft even when the scout already has the next assignment", async () => {
    const f = await fixture();
    const old = await f.context();
    await f.schedule(Math.floor(Date.now() / 1000) - 121);
    const next = await f.context();
    expect(next.currentMatch?.matchNumber).toBe(2);
    expect(next.assignedTeam).toBeTruthy();
    expect((await f.submit(old)).status).toBe(409);
    expect(await f.reports()).toEqual([]);
    expect((await f.submit(next)).status).toBe(201);
  });
  it("rejects missing match identity and wrong-team snapshots without saving", async () => {
    const f = await fixture();
    const context = await f.context();
    expect((await f.submit({ assignedTeam: context.assignedTeam })).status).toBe(409);
    expect((await f.submit(context, "9999")).status).toBe(409);
    expect(await f.reports()).toEqual([]);
  });
  it("closes the final match instead of keeping an expired form usable", async () => {
    const f = await fixture();
    const old = await f.context();
    await f.schedule(Math.floor(Date.now() / 1000) - 121, true);
    const expired = await f.context();
    expect(expired.currentMatch?.matchNumber).toBe(1);
    expect(expired.assignedTeam).toBeNull();
    expect(expired.submissionClosesAt).toBeLessThan(expired.serverNow);
    const response = await f.submit(old);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Time expired") });
    expect(await f.reports()).toEqual([]);
  });
  it("resets manual match identity without inventing an automatic deadline", async () => {
    const f = await fixture(true);
    const old = await f.context();
    expect(old.submissionClosesAt).toBeNull();
    await jsonAs(f.team.admin, "/scouting/event-context", {
      method: "PUT",
      body: { currentMatchNumber: 2 },
    });
    const next = await f.context();
    expect(next.currentMatch?.matchNumber).toBe(2);
    expect((await f.submit(old)).status).toBe(409);
    expect((await f.submit(next)).status).toBe(201);
  });
  it("rejects a changed assignment within the same match", async () => {
    const f = await fixture();
    const old = await f.context();
    await db
      .update(scoutingMatchAssignments)
      .set({ team_number: "9999" })
      .where(inTeam(scoutingMatchAssignments, f.team.teamId));
    expect((await f.submit(old)).status).toBe(409);
    expect(await f.reports()).toEqual([]);
  });
  it("rechecks after uploading a drawing and removes it if the match expired", async () => {
    const f = await fixture();
    const old = await f.context();
    const originalPut = bindings.FIELD_MAPS.put.bind(bindings.FIELD_MAPS);
    const upload = vi.spyOn(bindings.FIELD_MAPS, "put").mockImplementationOnce(async (...args) => {
      const result = await originalPut(...args);
      await f.schedule(Math.floor(Date.now() / 1000) - 121);
      return result;
    });
    try {
      expect((await f.submit(old, undefined, true)).status).toBe(409);
      expect(upload).toHaveBeenCalledOnce();
      expect(await f.reports()).toEqual([]);
      expect(
        (
          await bindings.FIELD_MAPS.list({
            prefix: `teams/${encodeURIComponent(f.team.teamId)}/scouting-submissions/`,
          })
        ).objects,
      ).toEqual([]);
    } finally {
      upload.mockRestore();
    }
  });
});
