import { env } from "cloudflare:workers";
import { withTeam } from "@g3/auth";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { boylebucksAccounts, manualEvents, strategyEventConfig } from "../src/db/schema";
import { StatboticsError, statboticsFailureMessage, statboticsMatches } from "../src/statbotics";
import type { AppEnv } from "../src/types";

const db = createDb((env as unknown as AppEnv["Bindings"]).SCOUTING_DB);
const event = (prefix: string) => `qa-${prefix}-${crypto.randomUUID()}`;
type Game = {
  eventName: string;
  account: { balance: number };
  matches: unknown[];
  statsError: string;
  bets: unknown[];
};
const score = (matches: unknown[]) =>
  (matches[0] as { pred: { red_score: number } }).pred.red_score;

async function gameTeam(eventKey: string) {
  const team = teamUsers(newTeamId());
  await jsonAs(team.admin, "/scouting/engagement-settings", {
    method: "PUT",
    body: {
      enabled: true,
      predictionsEnabled: true,
      combinationsEnabled: true,
      leaderboardEnabled: true,
      pointsLabel: "Test Points",
    },
  });
  await db.insert(strategyEventConfig).values(
    withTeam(team.teamId, {
      id: 1,
      event_key: eventKey,
      tba_auth_key: "test-key",
      updated_by: team.admin.id,
      updated_at: Date.now(),
    }),
  );
  await db.insert(boylebucksAccounts).values(
    withTeam(team.teamId, {
      user_id: team.student.id,
      display_name: team.student.displayName,
      balance: 100,
      earned: 100,
      wagered: 0,
      updated_at: Date.now(),
    }),
  );
  return team;
}

describe("bounded prediction loading", () => {
  it("shares concurrent public requests and caches displays while fresh checks bypass the cache", async () => {
    const key = event("cache");
    const [a, b] = await Promise.all([statboticsMatches(key), statboticsMatches(key)]);
    expect(score(a)).toBe(121);
    expect(b).toEqual(a);
    expect(score(await statboticsMatches(key))).toBe(121);
    expect(score(await statboticsMatches(key, true))).toBe(122);
  });

  it("fails fast on 500, briefly caches the failure and permits a fresh recovery check", async () => {
    const key = event("recover");
    await expect(statboticsMatches(key)).rejects.toThrow("(500)");
    await expect(statboticsMatches(key)).rejects.toThrow("(500)");
    expect(await statboticsMatches(key, true)).toHaveLength(2);
    expect(await statboticsMatches(key)).toHaveLength(2);
  });

  it("aborts a stalled service within three seconds", async () => {
    const started = Date.now();
    await expect(statboticsMatches(event("timeout"))).rejects.toThrow("too long");
    expect(Date.now() - started).toBeLessThan(4500);
  }, 10000);

  it("rejects malformed upstream data", async () => {
    await expect(statboticsMatches(event("invalid"))).rejects.toThrow("unexpected response");
  });

  it("returns points without contacting a slow prediction service", async () => {
    const team = await gameTeam(event("timeout"));
    const started = Date.now();
    const summary = await jsonAs<Game>(team.student, "/scouting/game?summary=true");
    expect(summary).toMatchObject({ account: { balance: 100 }, matches: [], statsError: "" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("keeps local game data available when Statbotics returns 500", async () => {
    const team = await gameTeam("2099qagrits");
    const game = await jsonAs<Game>(team.student, "/scouting/game");
    expect(game).toMatchObject({
      eventName: "GRITS",
      account: { balance: 100 },
      matches: [],
      bets: [],
    });
    expect(game.statsError).toBe(
      "Statbotics couldn't load GRITS predictions (server error 500). Try again shortly.",
    );
    expect(game.statsError).not.toContain("page found");
  });

  it("names a missing event and preserves the distinction in cached failures", async () => {
    const key = event("missing");
    const team = await gameTeam(key);
    await db.insert(manualEvents).values(
      withTeam(team.teamId, {
        event_key: key,
        event_name: "Example Invitational",
        ends_at: Date.now() + 86400000,
        delete_after: Date.now() + 172800000,
        created_by: team.admin.id,
        updated_at: Date.now(),
      }),
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const game = await jsonAs<Game>(team.student, "/scouting/game");
      expect(game.eventName).toBe("Example Invitational");
      expect(game.statsError).toBe("No Statbotics event page found for Example Invitational.");
      expect(game.account.balance).toBe(100);
    }
  });

  it("explains timeouts and unreadable responses without claiming an event is missing", () => {
    expect(
      statboticsFailureMessage(new StatboticsError("timeout", "timeout"), "Example Event"),
    ).toBe("Statbotics took too long to load Example Event predictions. Try again shortly.");
    expect(
      statboticsFailureMessage(new StatboticsError("invalid", "invalid"), "Example Event"),
    ).toBe("Statbotics returned unreadable predictions for Example Event. Try again shortly.");
  });

  it("cannot submit a cached prediction while live validation is failing or spend any points", async () => {
    const team = await gameTeam(event("fail-after"));
    const first = await jsonAs<Game>(team.student, "/scouting/game");
    expect(first.matches).toHaveLength(2);
    expect(first.statsError).toBe("");
    for (const route of ["bets", "parlays"]) {
      const pick = {
        matchKey: "shared-qm1",
        market: "spread",
        selection: "red",
        expectedLine: -10,
      };
      const body =
        route === "bets"
          ? { ...pick, stake: 10 }
          : { legs: [pick, { ...pick, matchKey: "shared-qm2" }], stake: 10 };
      expect(
        (await callAs(team.student, `/scouting/game/${route}`, { method: "POST", body })).status,
      ).toBe(503);
    }
    expect(await jsonAs<Game>(team.student, "/scouting/game?summary=true")).toMatchObject({
      account: { balance: 100 },
      bets: [],
    });
  });
});
