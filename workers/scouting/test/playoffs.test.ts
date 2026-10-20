import { SITE_TEAM, newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import {
  FORMATS,
  champion,
  dependents,
  matchIds,
  needsFinalists,
  nextMatch,
  resolveBracket,
  standings,
} from "../src/playoff-bracket";
import {
  STARTER_FIELDS,
  alliancesFromScan,
  alliancesFromTba,
  cleanAnswers,
  parseAlliances,
  parseFields,
} from "../src/playoffs";

type Slot = { slot: string; seed: number; team: string; claim: { userId: string } | null };
type Match = {
  id: string;
  red: number | null;
  blue: number | null;
  winner: string | null;
  slots: Slot[];
  startedAt: number | null;
};
type State = {
  canManage: boolean;
  questions: { id: string }[];
  session: null | {
    id: string;
    status: string;
    currentMatchId: string | null;
    openMatchId: string | null;
    ourSeed: number | null;
    champion: number | null;
    current: Match | null;
    open: Match | null;
    participants: { userId: string; scouted: number }[];
    me: { joined: boolean; reports: { matchId: string; slot: string }[] };
  };
};

describe("playoff brackets", () => {
  it("fills the 8-alliance double elimination bracket from winners", () => {
    let winners: Record<string, "red" | "blue"> = {};
    let bracket = resolveBracket("double8", winners);
    expect(bracket.slice(0, 4).map((m) => [m.red, m.blue])).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
    expect(nextMatch(bracket)?.id).toBe("M1");
    // Upper seeds win every upper match; the lower bracket's red side wins.
    winners = { M1: "red", M2: "red", M3: "red", M4: "red" };
    bracket = resolveBracket("double8", winners);
    const at = (id: string) => bracket.find((m) => m.id === id);
    expect([at("M5")?.red, at("M5")?.blue]).toEqual([8, 5]);
    expect([at("M7")?.red, at("M7")?.blue]).toEqual([1, 4]);
    expect(nextMatch(bracket)?.id).toBe("M5");
    winners = {
      ...winners,
      M5: "red",
      M6: "red",
      M7: "red",
      M8: "red",
      M9: "red",
      M10: "red",
      M11: "red",
      M12: "red",
      M13: "red",
    };
    bracket = resolveBracket("double8", winners);
    // M9: loser of M7 (4) beats winner of M6 (7); M10: loser of M8 (3) beats winner of M5 (8);
    // M12: 3 beats 4; M13: loser of M11 (2) beats 3. Finals: 1 vs 2.
    const finals = bracket.filter((m) => m.bracket === "finals");
    expect(finals.map((m) => [m.red, m.blue])).toEqual([
      [1, 2],
      [1, 2],
      [1, 2],
    ]);
    bracket = resolveBracket("double8", { ...winners, F1: "blue", F2: "blue" });
    expect(champion(bracket)).toBe(2);
    expect(bracket.find((m) => m.id === "F3")?.needed).toBe(false);
    expect(nextMatch(bracket)).toBeNull();
    bracket = resolveBracket("double8", { ...winners, F1: "blue", F2: "red" });
    expect(champion(bracket)).toBeNull();
    expect(nextMatch(bracket)?.id).toBe("F3");
  });

  it("has a 4-alliance bracket and knows what follows from each match", () => {
    expect(matchIds("double4")).toEqual(["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3"]);
    const bracket = resolveBracket("double4", { M1: "blue", M2: "red", M3: "red", M4: "red" });
    const m5 = bracket.find((m) => m.id === "M5");
    // M4: 4 beats 2; M3: 1 beats 3. M5 is the loser of M4 against the winner of M3.
    expect([m5?.red, m5?.blue]).toEqual([2, 1]);
    expect(dependents("double4", "M4").sort()).toEqual(["F1", "F2", "F3", "M5"]);
    expect(dependents("double8", "M1").sort()).toEqual(
      ["F1", "F2", "F3", "M10", "M11", "M12", "M13", "M5", "M7", "M9"].sort(),
    );
    expect(dependents("double8", "F2")).toEqual(["F3"]);
  });

  it("ignores a winner for a match whose alliances aren't known", () => {
    const bracket = resolveBracket("double8", { M7: "red" });
    expect(bracket.find((m) => m.id === "M7")?.winner).toBeNull();
  });
});

describe("round robins", () => {
  it("plays every pair once, each alliance once a round", () => {
    for (const format of ["roundrobin4", "roundrobin6"] as const) {
      const n = FORMATS[format].alliances;
      const bracket = resolveBracket(format, {});
      const played = bracket.filter((m) => m.bracket === "roundrobin");
      expect(played).toHaveLength((n * (n - 1)) / 2);
      const pairs = new Set(played.map((m) => [m.red, m.blue].sort().join("-")));
      expect(pairs.size).toBe(played.length);
      for (const round of new Set(played.map((m) => m.round))) {
        const seeds = played.filter((m) => m.round === round).flatMap((m) => [m.red, m.blue]);
        expect(new Set(seeds).size).toBe(n);
      }
      // Every alliance is red within one match of half the time.
      for (let seed = 1; seed <= n; seed += 1)
        expect(
          Math.abs(played.filter((m) => m.red === seed).length * 2 - (n - 1)),
        ).toBeLessThanOrEqual(1);
    }
  });

  it("ranks by points, sends the top two to the finals, and asks when they're level", () => {
    // M1 1v4, M2 3v2, M3 3v1, M4 2v4, M5 1v2, M6 4v3.
    const results = { M1: "red", M2: "red", M3: "tie", M4: "red", M5: "red", M6: "tie" } as const;
    let bracket = resolveBracket("roundrobin4", results);
    expect(standings("roundrobin4", bracket).map((row) => [row.seed, row.points])).toEqual([
      [1, 5],
      [3, 4],
      [2, 2],
      [4, 1],
    ]);
    const final = bracket.find((m) => m.id === "F1");
    expect([final?.red, final?.blue]).toEqual([1, 3]);
    expect(nextMatch(bracket)?.id).toBe("F1");
    expect(dependents("roundrobin4", "M3")).toEqual(["F1", "F2", "F3"]);
    // All ties: everyone has 3 points, so a lead chooses.
    const ties = Object.fromEntries(
      matchIds("roundrobin4")
        .slice(0, 6)
        .map((id) => [id, "tie" as const]),
    );
    bracket = resolveBracket("roundrobin4", ties);
    expect(needsFinalists("roundrobin4", bracket)).toBe(true);
    expect(nextMatch(bracket)).toBeNull();
    bracket = resolveBracket("roundrobin4", ties, [4, 2]);
    expect(needsFinalists("roundrobin4", bracket)).toBe(false);
    expect(bracket.find((m) => m.id === "F1")?.red).toBe(4);
    // A final can't be a tie.
    expect(
      resolveBracket("roundrobin4", { ...ties, F1: "tie" }, [4, 2]).find((m) => m.id === "F1")
        ?.winner,
    ).toBeNull();
  });
});

describe("parsing", () => {
  it("checks questions and answers", () => {
    expect(parseFields([])).toBe("Add at least one question.");
    expect(parseFields([{ label: "Pick", type: "mcq", options: ["One"], appliesTo: "team" }])).toBe(
      "Pick: add at least two choices.",
    );
    const fields = parseFields(STARTER_FIELDS);
    expect(Array.isArray(fields)).toBe(true);
    expect(
      cleanAnswers(STARTER_FIELDS, { bay: "4", auto: "  Left side  ", notes: "", extra: "x" }),
    ).toEqual({ auto: "Left side" });
  });

  it("reads alliances from TBA, a scan and the page", () => {
    expect(
      alliancesFromTba([
        { name: "Alliance 2", picks: ["frc10", "frc20", "frc30"], backup: { in: "frc40" } },
      ]),
    ).toEqual([{ seed: 2, teams: ["10", "20", "30", "40"] }]);
    expect(
      alliancesFromScan({
        alliances: [
          { n: 2, t: [2974, 4188, 6925] },
          { n: 1, t: [1261, null, 4509] },
          { n: 9, t: [1, 2, 3] },
        ],
      }),
    ).toEqual([
      { seed: 1, teams: ["1261", "", "4509"] },
      { seed: 2, teams: ["2974", "4188", "6925"] },
    ]);
    const partial = parseAlliances([{ seed: 1, teams: ["1", "2"] }], "double4", false);
    expect(partial).toEqual([
      { seed: 1, teams: ["1", "2"] },
      { seed: 2, teams: [] },
      { seed: 3, teams: [] },
      { seed: 4, teams: [] },
    ]);
    expect(parseAlliances(partial, "double4", true)).toBe("Alliance 1 needs three teams.");
    expect(
      parseAlliances(
        [1, 2, 3, 4].map((seed) => ({ seed, teams: [`${seed}1`, `${seed}2`, "99"] })),
        "double4",
        true,
      ),
    ).toBe("Team 99 is on two alliances.");
  });
});

/** A team with a playoff session set up for four alliances, ours on alliance 2. */
async function setUp() {
  const team = teamUsers(newTeamId());
  const ours = team.teamId.replace(/^frc/, "");
  const alliances = [
    { seed: 1, teams: ["101", "102", "103"] },
    { seed: 2, teams: [ours, "202", "203", "204"] },
    { seed: 3, teams: ["301", "302", "303"] },
    { seed: 4, teams: ["401", "402", "403"] },
  ];
  await jsonAs(
    team.admin,
    "/scouting/playoffs/setup",
    {
      method: "POST",
      body: { eventName: "Test Playoffs", format: "double4" },
    },
    201,
  );
  await jsonAs(team.admin, "/scouting/playoffs/setup", { method: "PUT", body: { alliances } });
  return { team, ours };
}

const state = (user: Parameters<typeof jsonAs>[0]) => jsonAs<State>(user, "/scouting/playoffs");

describe("a playoff session", () => {
  it("is set up and run by strategy leads; others wait until it starts", async () => {
    const { team } = await setUp();
    expect((await state(team.student)).session).toBeNull();
    expect((await state(team.student)).canManage).toBe(false);
    expect((await state(team.admin)).session?.status).toBe("setup");
    for (const user of [team.student, team.mentor, team.kioskAdmin])
      expect((await callAs(user, "/scouting/playoffs/start", { method: "POST" })).status).toBe(403);
    expect(
      (
        await callAs(team.admin, "/scouting/playoffs/setup", {
          method: "POST",
          body: { format: "double8" },
        })
      ).status,
    ).toBe(409);
    // Start needs every alliance's three robots.
    expect(
      (
        await callAs(team.admin, "/scouting/playoffs/setup", {
          method: "PUT",
          body: { format: "double8" },
        })
      ).status,
    ).toBe(200);
    expect((await callAs(team.admin, "/scouting/playoffs/start", { method: "POST" })).status).toBe(
      400,
    );
    await jsonAs(team.admin, "/scouting/playoffs/setup", { method: "DELETE" });
    expect((await state(team.admin)).session).toBeNull();
  });

  it("gives out slots, takes reports and moves through the bracket", async () => {
    const { team, ours } = await setUp();
    await jsonAs(team.admin, "/scouting/playoffs/start", { method: "POST" });
    let live = (await state(team.student)).session;
    expect(live?.current?.id).toBe("M1");
    expect(live?.ourSeed).toBe(2);
    expect(live?.current?.slots.map((s) => s.slot)).toEqual([
      "red:overall",
      "red:101",
      "red:102",
      "red:103",
      "blue:overall",
      "blue:401",
      "blue:402",
      "blue:403",
    ]);

    // Claiming: join first, one slot each, first come first served.
    const claim = (user: typeof team.student, slot: string) =>
      callAs(user, "/scouting/playoffs/matches/M1/claim", { method: "PUT", body: { slot } });
    expect((await claim(team.student, "red:101")).status).toBe(403);
    for (const user of [team.student, team.otherStudent, team.kioskAdmin])
      await jsonAs(user, "/scouting/playoffs/join", { method: "POST" });
    expect((await claim(team.student, "red:101")).status).toBe(200);
    expect((await claim(team.otherStudent, "red:101")).status).toBe(409);
    expect((await claim(team.student, "red:999")).status).toBe(400);
    expect((await claim(team.student, "red:overall")).status).toBe(200);
    expect((await claim(team.otherStudent, "red:101")).status).toBe(200);
    live = (await state(team.student)).session;
    const holders = Object.fromEntries(
      (live?.current?.slots ?? []).map((s) => [s.slot, s.claim?.userId ?? null]),
    );
    expect(holders["red:overall"]).toBe(team.student.id);
    expect(holders["red:101"]).toBe(team.otherStudent.id);

    // Forms open once the match starts, only for the slot's holder.
    const report = (user: typeof team.student, match: string, slot: string, notes: string) =>
      callAs(user, `/scouting/playoffs/matches/${match}/reports/${slot}`, {
        method: "PUT",
        body: { answers: { notes, bay: "2" } },
      });
    expect((await report(team.student, "M1", "red:overall", "Early")).status).toBe(409);
    await jsonAs(team.admin, "/scouting/playoffs/matches/M1/start", { method: "POST" });
    expect((await report(team.otherStudent, "M1", "red:overall", "Not mine")).status).toBe(403);
    const saved = await jsonAs<{ answers: Record<string, unknown> }>(
      team.student,
      "/scouting/playoffs/matches/M1/reports/red:overall",
      { method: "PUT", body: { answers: { notes: "Double sweep", bay: "2" } } },
    );
    // Driver station is a robot's question, not the alliance's.
    expect(saved.answers).toEqual({ notes: "Double sweep" });
    expect((await report(team.student, "M1", "red:overall", "Edited")).status).toBe(200);

    // A winner moves on to M2; M1 still takes reports until M2 starts.
    expect(
      (
        await callAs(team.student, "/scouting/playoffs/matches/M1/winner", {
          method: "POST",
          body: { winner: "red" },
        })
      ).status,
    ).toBe(403);
    await jsonAs(team.admin, "/scouting/playoffs/matches/M1/winner", {
      method: "POST",
      body: { winner: "red" },
    });
    live = (await state(team.otherStudent)).session;
    expect(live?.currentMatchId).toBe("M2");
    expect(live?.open?.id).toBe("M1");
    expect((await report(team.otherStudent, "M1", "red:101", "Late notes")).status).toBe(200);
    await jsonAs(team.admin, "/scouting/playoffs/matches/M2/start", { method: "POST" });
    expect((await report(team.otherStudent, "M1", "red:101", "Too late")).status).toBe(409);

    // Undo: allowed while nothing fed by the match has started; M1's result feeds M3 and M4.
    await jsonAs(team.admin, "/scouting/playoffs/matches/M2/winner", {
      method: "POST",
      body: { winner: "blue" },
    });
    expect((await state(team.admin)).session?.current?.id).toBe("M3");
    await jsonAs(team.admin, "/scouting/playoffs/matches/M2/winner", { method: "DELETE" });
    expect((await state(team.admin)).session?.current?.id).toBe("M2");
    await jsonAs(team.admin, "/scouting/playoffs/matches/M2/winner", {
      method: "POST",
      body: { winner: "red" },
    });
    await jsonAs(team.admin, "/scouting/playoffs/matches/M3/start", { method: "POST" });
    expect(
      (await callAs(team.admin, "/scouting/playoffs/matches/M1/winner", { method: "DELETE" }))
        .status,
    ).toBe(409);

    // Auto assign leaves our own alliance out (it's in M4, as 1 vs 2).
    await jsonAs(team.admin, "/scouting/playoffs/setup", {
      method: "PUT",
      body: { assignMode: "auto" },
    });
    await jsonAs(team.admin, "/scouting/playoffs/matches/M3/winner", {
      method: "POST",
      body: { winner: "red" },
    });
    live = (await state(team.admin)).session;
    expect(live?.current?.id).toBe("M4");
    const assigned = (live?.current?.slots ?? []).filter((s) => s.claim);
    // Three scouts, alliance 1's slots only: the least-used scout gets the alliance as a whole.
    expect(assigned.map((s) => s.slot)).toEqual(["red:overall", "red:101", "red:102"]);
    expect(assigned[0].claim?.userId).toBe(team.kioskAdmin.id);
    expect(assigned.every((s) => s.seed !== 2)).toBe(true);
    expect(live?.current?.slots.some((s) => s.team === ours)).toBe(true);
    // In auto mode scouts don't pick for themselves.
    expect(
      (
        await callAs(team.student, "/scouting/playoffs/matches/M4/claim", {
          method: "PUT",
          body: { slot: "red:102" },
        })
      ).status,
    ).toBe(403);

    // A backup can come onto the field for one match.
    await jsonAs(team.admin, "/scouting/playoffs/matches/M4/lineup", {
      method: "PUT",
      body: { red: ["101", "102", "103"], blue: [ours, "202", "204"] },
    });
    live = (await state(team.admin)).session;
    expect(live?.current?.slots.map((s) => s.slot)).toContain("blue:204");
    expect(
      (
        await callAs(team.admin, "/scouting/playoffs/matches/M4/lineup", {
          method: "PUT",
          body: { red: ["101", "301"], blue: [ours] },
        })
      ).status,
    ).toBe(400);

    // The rest of the bracket, then the data view.
    for (const [match, winner] of [
      ["M4", "red"],
      ["M5", "red"],
      ["F1", "red"],
      ["F2", "red"],
    ])
      await jsonAs(team.admin, `/scouting/playoffs/matches/${match}/winner`, {
        method: "POST",
        body: { winner },
      });
    live = (await state(team.admin)).session;
    expect(live?.champion).toBe(1);
    expect(live?.currentMatchId).toBeNull();
    await jsonAs(team.admin, "/scouting/playoffs/finish", { method: "POST" });
    expect((await state(team.student)).session).toBeNull();

    const { sessions } = await jsonAs<{ sessions: { id: string; status: string }[] }>(
      team.student,
      "/scouting/playoffs/sessions",
    );
    expect(sessions.map((s) => s.status)).toEqual(["finished"]);
    const data = await jsonAs<{
      reports: { matchId: string; slot: string; team: string; answers: Record<string, string> }[];
    }>(team.student, `/scouting/playoffs/sessions/${sessions[0].id}`);
    expect(data.reports.map((r) => [r.matchId, r.slot, r.answers.notes])).toEqual([
      ["M1", "red:overall", "Edited"],
      ["M1", "red:101", "Late notes"],
    ]);
    expect(data.reports[1].team).toBe("101");

    // Only leads delete a finished session.
    expect(
      (
        await callAs(team.student, `/scouting/playoffs/sessions/${sessions[0].id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    await jsonAs(team.admin, `/scouting/playoffs/sessions/${sessions[0].id}`, { method: "DELETE" });
  });

  it("runs a round robin, with ties and finalists chosen by a lead", async () => {
    const team = teamUsers(newTeamId());
    await jsonAs(
      team.admin,
      "/scouting/playoffs/setup",
      {
        method: "POST",
        body: { format: "roundrobin4" },
      },
      201,
    );
    await jsonAs(team.admin, "/scouting/playoffs/setup", {
      method: "PUT",
      body: {
        alliances: [1, 2, 3, 4].map((seed) => ({
          seed,
          teams: [`${seed}1`, `${seed}2`, `${seed}3`],
        })),
      },
    });
    await jsonAs(team.admin, "/scouting/playoffs/start", { method: "POST" });
    for (const match of ["M1", "M2", "M3", "M4", "M5", "M6"]) {
      expect((await state(team.admin)).session?.currentMatchId).toBe(match);
      await jsonAs(team.admin, `/scouting/playoffs/matches/${match}/winner`, {
        method: "POST",
        body: { winner: "tie" },
      });
    }
    // Everyone level: no finals until a lead chooses.
    let live = (await state(team.student)).session as unknown as {
      currentMatchId: string | null;
      needsFinalists: boolean;
      standings: { seed: number; points: number }[];
    };
    expect(live.currentMatchId).toBeNull();
    expect(live.needsFinalists).toBe(true);
    expect(live.standings.every((row) => row.points === 3)).toBe(true);
    const choose = (user: typeof team.admin, seeds: number[]) =>
      callAs(user, "/scouting/playoffs/finalists", { method: "PUT", body: { seeds } });
    expect((await choose(team.student, [2, 3])).status).toBe(403);
    expect((await choose(team.admin, [2, 2])).status).toBe(400);
    expect((await choose(team.admin, [2, 3])).status).toBe(200);
    live = (await state(team.student)).session as unknown as typeof live;
    expect(live.currentMatchId).toBe("F1");
    const current = (await state(team.admin)).session?.current;
    expect([current?.red, current?.blue]).toEqual([2, 3]);
    // Finals can't tie; once one starts, the round robin and the finalists are settled.
    expect(
      (
        await callAs(team.admin, "/scouting/playoffs/matches/F1/winner", {
          method: "POST",
          body: { winner: "tie" },
        })
      ).status,
    ).toBe(400);
    await jsonAs(team.admin, "/scouting/playoffs/matches/F1/start", { method: "POST" });
    expect((await choose(team.admin, [1, 4])).status).toBe(409);
    expect(
      (await callAs(team.admin, "/scouting/playoffs/matches/M6/winner", { method: "DELETE" }))
        .status,
    ).toBe(409);
    for (const final of ["F1", "F2"])
      await jsonAs(team.admin, `/scouting/playoffs/matches/${final}/winner`, {
        method: "POST",
        body: { winner: "blue" },
      });
    expect((await state(team.admin)).session?.champion).toBe(3);
  });

  it("keeps the team's questions from session to session", async () => {
    const team = teamUsers(newTeamId());
    expect((await state(team.student)).questions.map((q) => q.id)).toEqual(
      STARTER_FIELDS.map((f) => f.id),
    );
    const fields = [
      {
        id: "defense",
        label: "Defense",
        type: "slider",
        min: 0,
        max: 5,
        step: 1,
        appliesTo: "both",
      },
    ];
    expect(
      (
        await callAs(team.student, "/scouting/playoffs/questions", {
          method: "PUT",
          body: { fields },
        })
      ).status,
    ).toBe(403);
    await jsonAs(team.admin, "/scouting/playoffs/questions", { method: "PUT", body: { fields } });
    expect((await state(team.student)).questions.map((q) => q.id)).toEqual(["defense"]);
  });

  it("fills alliances from The Blue Alliance", async () => {
    // The site team has the deployment's TBA key.
    const team = teamUsers(SITE_TEAM);
    const filled = await jsonAs<{ alliances: { seed: number; teams: string[] }[] }>(
      team.admin,
      "/scouting/playoffs/alliances/tba",
      { method: "POST", body: { eventKey: "2099qaplayoffs" } },
    );
    expect(filled.alliances[0]).toEqual({ seed: 1, teams: ["1261", "1771", "4509"] });
    expect(
      (
        await callAs(team.admin, "/scouting/playoffs/alliances/tba", {
          method: "POST",
          body: { eventKey: "2099qanothing" },
        })
      ).status,
    ).toBe(502);
  });
});
