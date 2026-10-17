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
  scoutMatch: { key: string; matchNumber: number } | null;
  assignedTeam: string | null;
  submissionClosesAt: number | null;
  serverNow: number;
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
    await db
      .insert(tbaMatchCache)
      .values({
        event_key: eventKey,
        matches_json: JSON.stringify(rows),
        expires_at: Date.now() + 600000,
      })
      .onConflictDoUpdate({
        target: tbaMatchCache.event_key,
        set: { matches_json: JSON.stringify(rows) },
      });
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
    const match = snapshot.scoutMatch ?? snapshot.currentMatch;
    if (match) body.set("matchKey", match.key);
    body.set("teamName", overrideTeam ?? snapshot.assignedTeam ?? "");
    body.set("answers", JSON.stringify({ score: 5 }));
    if (drawing) body.set("drawing", new File(["test-image"], "auto.png", { type: "image/png" }));
    return callAs(team.student, `/scouting/scouting-forms/${id}/submissions`, {
      method: "POST",
      body,
    });
  };
  const lateWindow = (seconds: number) =>
    db
      .update(strategyEventConfig)
      .set({ late_window_seconds: seconds })
      .where(inTeam(strategyEventConfig, team.teamId));
  const reports = () =>
    db
      .select()
      .from(scoutingFormSubmissions)
      .where(inTeam(scoutingFormSubmissions, team.teamId))
      .all();
  return { team, eventKey, keys, schedule, context, submit, reports, lateWindow };
}

describe("scouting submission deadlines", () => {
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
  it("lands a report that missed the move on its own match, marked late", async () => {
    const f = await fixture();
    const old = await f.context();
    await f.schedule(Math.floor(Date.now() / 1000) - 121);
    const next = await f.context();
    expect(next.currentMatch?.matchNumber).toBe(2);
    expect(next.assignedTeam).toBeTruthy();
    expect((await f.submit(old)).status).toBe(201);
    expect((await f.submit(old)).status).toBe(409);
    expect((await f.submit(next)).status).toBe(201);
    const reports = await f.reports();
    expect(reports.find((report) => report.match_key === f.keys[0])).toMatchObject({
      match_number: 1,
      team_name: old.assignedTeam,
      submitted_late: 1,
    });
    expect(reports.find((report) => report.match_key === f.keys[1])).toMatchObject({
      submitted_late: 0,
    });
  });
  it("refuses a late report once the team's late window has passed", async () => {
    const f = await fixture();
    const old = await f.context();
    await f.lateWindow(60);
    // Match 1 moved on 80 seconds ago (ended 200 s ago, 120 s window): past a 60 s late window.
    await f.schedule(Math.floor(Date.now() / 1000) - 200);
    const response = await f.submit(old);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("too late") });
    expect(await f.reports()).toEqual([]);
  });
  it("never takes a report for a match that hasn't come up yet", async () => {
    const f = await fixture();
    const context = await f.context();
    const response = await f.submit({ ...context, scoutMatch: { key: f.keys[1], matchNumber: 2 } });
    expect(response.status).toBe(409);
    expect(await f.reports()).toEqual([]);
  });
  it("lets admins set the late window, within its limits", async () => {
    const f = await fixture();
    const save = (lateWindowSeconds: unknown) =>
      callAs(f.team.admin, "/scouting/event-context", {
        method: "PUT",
        body: { eventKey: "", lateWindowSeconds },
      });
    expect((await save(4000)).status).toBe(400);
    expect((await save(-1)).status).toBe(400);
    expect((await save(300)).status).toBe(200);
    expect(
      (await jsonAs<{ lateWindowSeconds: number }>(f.team.student, "/scouting/event-context"))
        .lateWindowSeconds,
    ).toBe(300);
  });
  it("moves a scout who has sent their report on without waiting out the window", async () => {
    const f = await fixture();
    const first = await f.context();
    expect(first.scoutMatch?.matchNumber).toBe(1);
    expect((await f.submit(first)).status).toBe(201);
    // Match 1 has a result and match 2 has started, but match 1's window is still open.
    const moved = await f.context();
    expect(moved.currentMatch?.matchNumber).toBe(1);
    expect(moved.scoutMatch?.matchNumber).toBe(2);
    expect(moved.scoutMatch?.key).toBe(f.keys[1]);
    expect(moved.assignedTeam).toBeTruthy();
    expect(moved.submissionClosesAt).toBeNull();
    expect((await f.submit(moved)).status).toBe(201);
    expect((await f.reports()).map((report) => report.match_key).sort()).toEqual(f.keys);
  });
  it("keeps a scout on the match while their report for it is missing", async () => {
    const f = await fixture();
    const context = await f.context();
    expect(context.currentMatch?.matchNumber).toBe(1);
    expect(context.scoutMatch?.matchNumber).toBe(1);
    expect(context.submissionClosesAt).toBeGreaterThan(context.serverNow);
  });
  it("rejects missing match identity and wrong-team snapshots without saving", async () => {
    const f = await fixture();
    const context = await f.context();
    expect((await f.submit({ assignedTeam: context.assignedTeam })).status).toBe(409);
    expect((await f.submit(context, "9999")).status).toBe(409);
    expect(await f.reports()).toEqual([]);
  });
  it("stops assigning the final match once it closes, but still takes its report late", async () => {
    const f = await fixture();
    const old = await f.context();
    await f.schedule(Math.floor(Date.now() / 1000) - 121, true);
    const expired = await f.context();
    expect(expired.currentMatch?.matchNumber).toBe(1);
    expect(expired.assignedTeam).toBeNull();
    expect(expired.submissionClosesAt).toBeLessThan(expired.serverNow);
    expect((await f.submit(old)).status).toBe(201);
    expect(await f.reports()).toMatchObject([{ match_key: f.keys[0], submitted_late: 1 }]);
  });
  it("takes a manual match's report late after the lead moves on", async () => {
    const f = await fixture(true);
    const old = await f.context();
    expect(old.submissionClosesAt).toBeNull();
    await jsonAs(f.team.admin, "/scouting/event-context", {
      method: "PUT",
      body: { currentMatchNumber: 2 },
    });
    const next = await f.context();
    expect(next.currentMatch?.matchNumber).toBe(2);
    expect(next.submissionClosesAt).toBeNull();
    expect((await f.submit(old)).status).toBe(201);
    expect((await f.submit(next)).status).toBe(201);
    const reports = await f.reports();
    expect(reports.find((report) => report.match_number === 1)?.submitted_late).toBe(1);
    expect(reports.find((report) => report.match_number === 2)?.submitted_late).toBe(0);
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
  it("records a report as late when its match moves on during the upload", async () => {
    const f = await fixture();
    const old = await f.context();
    const originalPut = bindings.FIELD_MAPS.put.bind(bindings.FIELD_MAPS);
    const upload = vi.spyOn(bindings.FIELD_MAPS, "put").mockImplementationOnce(async (...args) => {
      const result = await originalPut(...args);
      await f.schedule(Math.floor(Date.now() / 1000) - 121);
      return result;
    });
    try {
      expect((await f.submit(old, undefined, true)).status).toBe(201);
      expect(await f.reports()).toMatchObject([{ match_key: f.keys[0], submitted_late: 1 }]);
    } finally {
      upload.mockRestore();
    }
  });
  it("rechecks after uploading a drawing and removes it if it became too late", async () => {
    const f = await fixture();
    const old = await f.context();
    await f.lateWindow(0);
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
