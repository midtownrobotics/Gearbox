import { env } from "cloudflare:workers";
import { inTeam, withTeam } from "@g3/auth";
import { newTeamId, teamUsers, testUser } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db";
import {
  boylebucksAccounts,
  boylebucksLedger,
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

async function enablePoints(f: Awaited<ReturnType<typeof fixture>>) {
  await jsonAs(f.team.admin, "/scouting/engagement-settings", {
    method: "PUT",
    body: {
      enabled: true,
      predictionsEnabled: false,
      combinationsEnabled: false,
      leaderboardEnabled: false,
      pointsLabel: "Scout Points",
    },
  });
}

function replacedLineup(row: TbaMatch) {
  return {
    ...row,
    alliances: {
      red: { team_keys: ["frc201", "frc202", "frc203"], score: row.alliances.red.score },
      blue: { team_keys: ["frc204", "frc205", "frc206"], score: row.alliances.blue.score },
    },
  };
}

describe("scouting overlap integrity", () => {
  it("repairs changed lineups without rewriting saved reports, rewards or drawings", async () => {
    const f = await fixture();
    await enablePoints(f);
    expect((await f.submit(await f.context(), undefined, true)).status).toBe(201);
    const saved = await f.reports();
    const ledger = await db
      .select()
      .from(boylebucksLedger)
      .where(inTeam(boylebucksLedger, f.team.teamId))
      .all();
    const originalImage = await bindings.FIELD_MAPS.get(saved[0].drawing_r2_key as string);
    expect(originalImage).not.toBeNull();
    const originalBytes = await originalImage?.arrayBuffer();
    expect(originalBytes?.byteLength).toBeGreaterThan(0);
    const old = await f.context();
    const rows = [
      match(f.keys[0], 1, Math.floor(Date.now() / 1000) - 30),
      replacedLineup(match(f.keys[1], 2, null)),
    ];
    await cacheSchedule(f.eventKey, rows);
    expect((await f.submit(old)).status).toBe(409);
    const repaired = await f.context();
    expect(["201", "202", "203", "204", "205", "206"]).toContain(repaired.assignedTeam);
    expect(repaired.assignedTeam).not.toBe(old.assignedTeam);
    expect((await f.submit(old)).status).toBe(409);
    expect((await f.submit(repaired)).status).toBe(201);
    expect((await f.reports()).find((row) => row.id === saved[0].id)).toEqual(saved[0]);
    const afterLedger = await db
      .select()
      .from(boylebucksLedger)
      .where(inTeam(boylebucksLedger, f.team.teamId))
      .all();
    expect(afterLedger.find((row) => row.id === ledger[0].id)).toEqual(ledger[0]);
    expect(
      await (await bindings.FIELD_MAPS.get(saved[0].drawing_r2_key as string))?.arrayBuffer(),
    ).toEqual(originalBytes);
  });

  it("rejects a lineup change during upload and removes only that rejected upload", async () => {
    const f = await fixture();
    const old = await f.context();
    const put = bindings.FIELD_MAPS.put.bind(bindings.FIELD_MAPS);
    const spy = vi.spyOn(bindings.FIELD_MAPS, "put").mockImplementationOnce(async (...args) => {
      const result = await put(...args);
      await cacheSchedule(f.eventKey, [
        replacedLineup(match(f.keys[0], 1, Math.floor(Date.now() / 1000) - 30)),
        match(f.keys[1], 2, null),
      ]);
      return result;
    });
    try {
      expect((await f.submit(old, undefined, true)).status).toBe(409);
      expect(await f.reports()).toEqual([]);
      expect(
        (
          await bindings.FIELD_MAPS.list({
            prefix: `teams/${encodeURIComponent(f.team.teamId)}/scouting-submissions/`,
          })
        ).objects,
      ).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("claims six different teams even when all scouts reach the assignment write together", async () => {
    const f = await fixture();
    const users = Array.from({ length: 6 }, (_, index) =>
      testUser({ id: `simultaneous-${index}`, teamId: f.team.teamId }),
    );
    let arrived = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prepare = bindings.SCOUTING_DB.prepare.bind(bindings.SCOUTING_DB);
    const spy = vi.spyOn(bindings.SCOUTING_DB, "prepare").mockImplementation((query) => {
      const statement = prepare(query);
      if (!query.includes("INSERT INTO") || !query.includes('"scouting_match_assignments"'))
        return statement;
      const bind = statement.bind.bind(statement);
      vi.spyOn(statement, "bind").mockImplementation((...values) => {
        const bound = bind(...values);
        const run = bound.run.bind(bound);
        vi.spyOn(bound, "run").mockImplementation(async () => {
          arrived++;
          if (arrived === 6) release();
          await gate;
          return run();
        });
        return bound;
      });
      return statement;
    });
    const timeout = setTimeout(release, 2000);
    try {
      const contexts = await Promise.all(
        users.map((user) => jsonAs<Context>(user, "/scouting/event-context?assign=true")),
      );
      expect(arrived).toBe(6);
      expect(new Set(contexts.map((context) => context.assignedTeam)).size).toBe(6);
      const again = await jsonAs<Context>(users[0], "/scouting/event-context?assign=true");
      expect(again.assignedTeam).toBe(contexts[0].assignedTeam);
    } finally {
      release();
      clearTimeout(timeout);
      spy.mockRestore();
    }
  });

  it("keeps assignment coverage private to each team using a shared public schedule", async () => {
    const a = await fixture();
    const b = await fixture();
    await db.insert(scoutingMatchAssignments).values(
      withTeam(b.team.teamId, {
        event_key: a.eventKey,
        match_number: 1,
        user_id: b.team.student.id,
        team_number: "101",
        assigned_at: Date.now(),
      }),
    );
    const before = await db
      .select()
      .from(scoutingMatchAssignments)
      .where(inTeam(scoutingMatchAssignments, b.team.teamId))
      .all();
    expect((await a.context()).assignedTeam).toBe("101");
    expect(
      await db
        .select()
        .from(scoutingMatchAssignments)
        .where(inTeam(scoutingMatchAssignments, b.team.teamId))
        .all(),
    ).toEqual(before);
  });

  it("never moves an ahead scout backward when an earlier result or delay is corrected", async () => {
    const f = await fixture();
    const now = Math.floor(Date.now() / 1000);
    const rows = [
      match(f.keys[0], 1, now - 30),
      match(f.keys[1], 2, null),
      match(`${f.eventKey}_qm3`, 3, null),
    ];
    await cacheSchedule(f.eventKey, rows);
    expect((await f.submit(await f.context())).status).toBe(201);
    const second = await f.context();
    rows[0].post_result_time = now - 121;
    await cacheSchedule(f.eventKey, rows);
    expect(await f.context()).toMatchObject({
      currentMatch: second.currentMatch,
      assignedTeam: second.assignedTeam,
    });
    expect((await f.submit(second)).status).toBe(201);
    const third = await f.context();
    expect(third.currentMatch?.matchNumber).toBe(3);
    const stored = await f.reports();
    rows[0].post_result_time = now - 30;
    await cacheSchedule(f.eventKey, rows);
    await jsonAs(f.team.admin, "/scouting/event-context", {
      method: "PUT",
      body: { currentMatchNumber: 2, submissionWindowSeconds: 300 },
    });
    expect(await f.context()).toMatchObject({
      currentMatch: third.currentMatch,
      assignedTeam: third.assignedTeam,
      hasSubmittedCurrentMatch: false,
    });
    expect(await f.reports()).toEqual(stored);
    expect((await f.submit(third)).status).toBe(201);
  });

  it("keeps a partial schedule from rolling back the saved current match", async () => {
    const f = await fixture();
    expect((await f.submit(await f.context())).status).toBe(201);
    await f.schedule(Math.floor(Date.now() / 1000) - 121);
    const current = await f.context();
    expect(current.currentMatch?.matchNumber).toBe(2);
    await cacheSchedule(f.eventKey, [match(f.keys[0], 1, Math.floor(Date.now() / 1000) - 121)]);
    expect((await callAs(f.team.student, "/scouting/event-context?assign=true")).status).toBe(503);
    expect(
      await db
        .select({ number: strategyEventConfig.current_match_number })
        .from(strategyEventConfig)
        .where(inTeam(strategyEventConfig, f.team.teamId))
        .get(),
    ).toEqual({ number: 2 });
    await f.schedule(Math.floor(Date.now() / 1000) - 121);
    expect(await f.context()).toMatchObject({
      currentMatch: current.currentMatch,
      assignedTeam: current.assignedTeam,
    });
  });

  it("starts a new event with its own cursor and preserves the old event's reports", async () => {
    const f = await fixture();
    await f.schedule(Math.floor(Date.now() / 1000) - 121);
    const second = await f.context();
    expect(second.currentMatch?.matchNumber).toBe(2);
    expect((await f.submit(second)).status).toBe(201);
    const stored = await f.reports();
    const eventKey = `2099qa${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const schedule = [
      match(`${eventKey}_qm1`, 1, Math.floor(Date.now() / 1000) - 30),
      match(`${eventKey}_qm2`, 2, null),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) =>
        Response.json(String(input).endsWith("/matches") ? schedule : { key: eventKey }),
      ),
    );
    try {
      await jsonAs(f.team.admin, "/scouting/event-context", {
        method: "PUT",
        body: { eventKey, currentMatchNumber: 2, tbaAuthKey: "test-only-key" },
      });
      expect((await f.context()).currentMatch?.matchNumber).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(await f.reports()).toEqual(stored);
  });

  it("saves one report, one reward and one retained drawing for concurrent duplicate submissions", async () => {
    const f = await fixture();
    await enablePoints(f);
    const snapshot = await f.context();
    const responses = await Promise.all([
      f.submit(snapshot, undefined, true),
      f.submit(snapshot, undefined, true),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await f.reports()).length).toBe(1);
    const accounts = await db
      .select()
      .from(boylebucksAccounts)
      .where(inTeam(boylebucksAccounts, f.team.teamId))
      .all();
    expect(accounts[0].balance).toBe(10);
    expect(
      (
        await bindings.FIELD_MAPS.list({
          prefix: `teams/${encodeURIComponent(f.team.teamId)}/scouting-submissions/`,
        })
      ).objects.length,
    ).toBe(1);
  });
});
