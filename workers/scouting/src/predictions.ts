import { inTeam, withTeam } from "@g3/auth";

import { sql } from "drizzle-orm";
import { Hono } from "hono";

import { type Db, type WriteQuery, all, batch, createDb, dbOf, first } from "./db";
import { adoptLegacyRows } from "./db/bootstrap";
import {
  boylebucksAccounts,
  boylebucksLedger,
  gameBets,
  gameParlayLegs,
  gameParlays,
  strategyEventConfig,
} from "./db/schema";
import { getEngagementSettings } from "./engagement";

import { requireAuth } from "./middleware/auth";

import type { AppEnv } from "./types";

import { finiteNumber, id, nested, record, teamNumber, text } from "./utils";
type GameMatch = {
  key: string;
  label: string;
  matchNumber: number;
  status: string;
  startTime: number | null;
  redTeams: string[];
  blueTeams: string[];
  redScore: number;
  blueScore: number;
  redWinProbability: number;
  actualRedScore: number | null;
  actualBlueScore: number | null;
};
function betProfit(stake: number, odds: number) {
  return Math.floor(odds > 0 ? (stake * odds) / 100 : (stake * 100) / Math.abs(odds));
}

function americanToDecimal(odds: number) {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function decimalToAmerican(decimal: number) {
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : -Math.round(100 / Math.max(0.01, decimal - 1));
}

function combinedAmericanOdds(odds: number[]) {
  return decimalToAmerican(
    odds.reduce((combined, value) => combined * americanToDecimal(value), 1),
  );
}

function settleSelection(
  match: GameMatch,
  market: string,
  selection: string,
  line: number,
): "won" | "lost" | "push" | null {
  if (match.actualRedScore === null || match.actualBlueScore === null) return null;
  const redMargin = match.actualRedScore - match.actualBlueScore;
  const total = match.actualRedScore + match.actualBlueScore;
  let result = 0;
  if (market === "spread") result = selection === "red" ? redMargin + line : -redMargin - line;
  else if (market === "total") result = selection === "over" ? total - line : line - total;
  else result = selection === "red" ? redMargin : -redMargin;
  return result > 0 ? "won" : result < 0 ? "lost" : "push";
}

function gameLine(match: GameMatch) {
  const predictedMargin = match.redScore - match.blueScore;
  return {
    spread: -(Math.sign(predictedMargin) * Math.round(Math.abs(predictedMargin) * 2)) / 2,
  };
}

function gameMatchIsOpen(match: GameMatch, now: number, currentMatchNumber: number) {
  if (match.actualRedScore !== null) return false;
  const status = match.status.toLowerCase();
  if (status && status !== "scheduled") return false;
  if (match.startTime) {
    const milliseconds =
      match.startTime < 10_000_000_000 ? match.startTime * 1000 : match.startTime;
    return milliseconds > now + 120_000;
  }
  return match.matchNumber > currentMatchNumber;
}

function normalizeGameMatch(value: unknown): GameMatch | null {
  const raw = record(value);
  const prediction = record(raw.pred ?? raw.prediction);
  const alliances = record(raw.alliances);
  const redAlliance = record(alliances.red);
  const blueAlliance = record(alliances.blue);
  const result = record(raw.result);
  const key = text(raw.key ?? raw.match, 100);
  const matchNumber = finiteNumber(raw.match_number ?? raw.matchNumber) ?? 0;
  const redScore = finiteNumber(prediction.red_score ?? prediction.redScore);
  const blueScore = finiteNumber(prediction.blue_score ?? prediction.blueScore);
  const redWinProbability = finiteNumber(
    prediction.red_win_prob ?? prediction.redWinProbability ?? prediction.red_win_probability,
  );
  if (!key || !matchNumber || redScore === null || blueScore === null || redWinProbability === null)
    return null;
  const teamKeys = (alliance: Record<string, unknown>) => {
    const candidates = alliance.team_keys ?? alliance.teams;
    return (Array.isArray(candidates) ? candidates : [])
      .slice(0, 3)
      .map((team) => teamNumber(team, false))
      .filter(Boolean);
  };
  const actualRedScore = finiteNumber(
    result.red_score ?? result.redScore ?? redAlliance.score ?? nested(raw, "actual", "red_score"),
  );
  const actualBlueScore = finiteNumber(
    result.blue_score ??
      result.blueScore ??
      blueAlliance.score ??
      nested(raw, "actual", "blue_score"),
  );
  const level =
    text(raw.comp_level ?? raw.compLevel, 10) ||
    key
      .split("_")
      .at(-1)
      ?.match(/^[a-z]+/)?.[0] ||
    "qm";
  return {
    key,
    label:
      text(raw.match_name ?? raw.matchName, 100) ||
      (level === "qm" ? `Qualification ${matchNumber}` : `${level.toUpperCase()} ${matchNumber}`),
    matchNumber,
    status: text(raw.status, 30),
    startTime: finiteNumber(raw.predicted_time ?? raw.time ?? raw.scheduled_time),
    redTeams: teamKeys(redAlliance),
    blueTeams: teamKeys(blueAlliance),
    redScore,
    blueScore,
    redWinProbability: Math.min(1, Math.max(0, redWinProbability)),
    actualRedScore:
      actualRedScore !== null &&
      actualRedScore >= 0 &&
      actualBlueScore !== null &&
      actualBlueScore >= 0
        ? actualRedScore
        : null,
    actualBlueScore:
      actualRedScore !== null &&
      actualRedScore >= 0 &&
      actualBlueScore !== null &&
      actualBlueScore >= 0
        ? actualBlueScore
        : null,
  };
}

async function getStatboticsMatches(eventKey: string) {
  const url = `https://api.statbotics.io/v3/matches?event=${encodeURIComponent(eventKey)}&limit=500`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Gearbox-Strategy/1.0" },
    });
    if (response.ok) {
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body)) throw new Error("Statbotics returned an unexpected response.");
      return body
        .map(normalizeGameMatch)
        .filter((match): match is GameMatch => Boolean(match))
        .sort(
          (left, right) =>
            (left.startTime ?? Number.MAX_SAFE_INTEGER) -
              (right.startTime ?? Number.MAX_SAFE_INTEGER) || left.key.localeCompare(right.key),
        );
    }
    if (attempt === 3 || (response.status !== 429 && response.status < 500))
      throw new Error(`Statbotics returned ${response.status}.`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }
  return [];
}

function localDemoGameMatches(teamId: string): GameMatch[] {
  const now = Date.now();
  return [
    {
      redTeams: [teamId.replace(/^frc/, ""), "1771", "2974"],
      blueTeams: ["4910", "6829", "8736"],
      redScore: 142.4,
      blueScore: 135.1,
      redWinProbability: 0.63,
    },
    {
      redTeams: ["1261", "1683", "5900"],
      blueTeams: ["1746", "3635", "4188"],
      redScore: 128.7,
      blueScore: 139.8,
      redWinProbability: 0.31,
    },
    {
      redTeams: ["1002", "1414", "6340"],
      blueTeams: ["2415", "4026", "5293"],
      redScore: 151.2,
      blueScore: 149.5,
      redWinProbability: 0.53,
    },
    {
      redTeams: [teamId.replace(/^frc/, ""), "4188", "6829"],
      blueTeams: ["1771", "4910", "5900"],
      redScore: 146.9,
      blueScore: 141.3,
      redWinProbability: 0.59,
    },
  ].map((match, index) => ({
    ...match,
    key: `local-demo_qm${index + 1}`,
    label: `Qualification ${index + 1}`,
    matchNumber: index + 1,
    status: "Scheduled",
    startTime: now + (index + 1) * 900_000,
    actualRedScore: null,
    actualBlueScore: null,
  }));
}

async function gameMatches(env: AppEnv["Bindings"], eventKey: string, teamId: string) {
  if (env.LOCAL_AUTH_BYPASS === "true" && eventKey === "local-demo")
    return localDemoGameMatches(teamId);
  return getStatboticsMatches(eventKey);
}

async function settleGameBets(db: Db, teamId: string, eventKey: string, matches: GameMatch[]) {
  const completed = new Map(
    matches
      .filter((match) => match.actualRedScore !== null && match.actualBlueScore !== null)
      .map((match) => [match.key, match]),
  );
  if (!completed.size) return;
  const open = await all<Record<string, unknown>>(
    db,
    sql`SELECT id, user_id, match_key, market, selection, line, odds, stake FROM (SELECT * FROM ${gameBets} WHERE ${inTeam(gameBets, teamId)}) AS scoped_game_bets WHERE event_key = ${eventKey} AND status = 'open'`,
  );
  for (const bet of open.results) {
    const match = completed.get(String(bet.match_key));
    if (!match) continue;
    const status = settleSelection(
      match,
      String(bet.market),
      String(bet.selection),
      Number(bet.line),
    );
    if (!status) continue;
    const stake = Number(bet.stake);
    const payout =
      status === "won" ? stake + betProfit(stake, Number(bet.odds)) : status === "push" ? stake : 0;
    const now = Date.now();
    const statements: WriteQuery[] = [
      db
        .update(gameBets)
        .set({ status: status, payout: payout, settled_at: now })
        .where(inTeam(gameBets, teamId, sql`id = ${bet.id} AND status = 'open'`)),
    ];
    if (payout > 0) {
      statements.push(
        db
          .update(boylebucksAccounts)
          .set({ balance: sql`balance + ${payout}`, updated_at: now })
          .where(
            inTeam(
              boylebucksAccounts,
              teamId,
              sql`user_id = ${bet.user_id}
              AND EXISTS (
                SELECT 1 FROM (SELECT * FROM ${gameBets} WHERE ${inTeam(gameBets, teamId)}) AS scoped_game_bets
                 WHERE id = ${bet.id} AND status = ${status} AND settled_at = ${now}
              )
              AND NOT EXISTS (
                SELECT 1 FROM (SELECT * FROM ${boylebucksLedger} WHERE ${inTeam(boylebucksLedger, teamId)}) AS scoped_boylebucks_ledger WHERE reference_id = ${`bet:${bet.id}`}
              )`,
            ),
          ),
        db
          .insert(boylebucksLedger)
          .values(
            withTeam(teamId, {
              id: id("ledger"),
              user_id: String(bet.user_id),
              amount: payout,
              reason: status === "push" ? "Bet refunded" : "Bet won",
              reference_id: `bet:${bet.id}`,
              created_at: now,
            }),
          )
          .onConflictDoNothing(),
      );
    }
    await batch(db, statements);
  }
}

async function settleGameParlays(db: Db, teamId: string, eventKey: string, matches: GameMatch[]) {
  const matchMap = new Map(matches.map((match) => [match.key, match]));
  const open = await all<Record<string, unknown>>(
    db,
    sql`SELECT p.id, p.user_id, p.stake, l.id AS leg_id, l.match_key, l.market,
            l.selection, l.line, l.odds, l.status
       FROM (SELECT * FROM ${gameParlays} WHERE ${inTeam(gameParlays, teamId)}) AS p
       JOIN (SELECT * FROM ${gameParlayLegs} WHERE ${inTeam(gameParlayLegs, teamId)}) AS l ON l.parlay_id = p.id
      WHERE p.event_key = ${eventKey} AND p.status = 'open'
      ORDER BY p.id`,
  );
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of open.results)
    grouped.set(String(row.id), [...(grouped.get(String(row.id)) ?? []), row]);
  for (const [parlayId, legs] of Array.from(grouped.entries())) {
    const updates: WriteQuery[] = [];
    const results = legs.map((leg) => {
      if (String(leg.status) !== "open") return String(leg.status) as "won" | "lost" | "push";
      const match = matchMap.get(String(leg.match_key));
      if (!match) return null;
      const result = settleSelection(
        match,
        String(leg.market),
        String(leg.selection),
        Number(leg.line),
      );
      if (result)
        updates.push(
          db
            .update(gameParlayLegs)
            .set({ status: result })
            .where(inTeam(gameParlayLegs, teamId, sql`id = ${leg.leg_id} AND status = 'open'`)),
        );
      return result;
    });
    if (updates.length) await batch(db, updates);
    const hasLostLeg = results.includes("lost");
    if (!hasLostLeg && results.some((result) => result === null)) continue;
    const finalStatus = hasLostLeg
      ? "lost"
      : results.every((result) => result === "push")
        ? "push"
        : "won";
    const activeOdds = legs
      .filter((_, index) => results[index] === "won")
      .map((leg) => Number(leg.odds));
    const stake = Number(legs[0].stake);
    const payout =
      finalStatus === "won"
        ? stake + betProfit(stake, combinedAmericanOdds(activeOdds))
        : finalStatus === "push"
          ? stake
          : 0;
    const now = Date.now();
    const statements: WriteQuery[] = [
      db
        .update(gameParlays)
        .set({ status: finalStatus, payout: payout, settled_at: now })
        .where(inTeam(gameParlays, teamId, sql`id = ${parlayId} AND status = 'open'`)),
    ];
    if (payout > 0) {
      statements.push(
        db
          .update(boylebucksAccounts)
          .set({ balance: sql`balance + ${payout}`, updated_at: now })
          .where(
            inTeam(
              boylebucksAccounts,
              teamId,
              sql`user_id = ${legs[0].user_id}
              AND EXISTS (SELECT 1 FROM (SELECT * FROM ${gameParlays} WHERE ${inTeam(gameParlays, teamId)}) AS scoped_game_parlays WHERE id = ${parlayId} AND settled_at = ${now})
              AND NOT EXISTS (SELECT 1 FROM (SELECT * FROM ${boylebucksLedger} WHERE ${inTeam(boylebucksLedger, teamId)}) AS scoped_boylebucks_ledger WHERE reference_id = ${`parlay:${parlayId}`})`,
            ),
          ),
        db
          .insert(boylebucksLedger)
          .values(
            withTeam(teamId, {
              id: id("ledger"),
              user_id: String(legs[0].user_id),
              amount: payout,
              reason: finalStatus === "push" ? "Parlay refunded" : "Parlay won",
              reference_id: `parlay:${parlayId}`,
              created_at: now,
            }),
          )
          .onConflictDoNothing(),
      );
    }
    await batch(db, statements);
  }
}

export async function settleConfiguredGame(
  env: AppEnv["Bindings"],
  purgeExpiredManualEvents: (db: Db, teamId: string) => Promise<void>,
) {
  await adoptLegacyRows(env.SCOUTING_DB);
  const db = createDb(env.SCOUTING_DB);
  // tenancy: all teams (the scheduler discovers explicit teams, then scopes every operation)
  const teams = await db.select({ teamId: strategyEventConfig.teamId }).from(strategyEventConfig);
  for (const { teamId } of teams) {
    try {
      await purgeExpiredManualEvents(db, teamId);
      const settings = await getEngagementSettings(env.SCOUTING_DB, teamId);
      if (!settings.enabled || !settings.predictionsEnabled) continue;
      const config = await db
        .select()
        .from(strategyEventConfig)
        .where(inTeam(strategyEventConfig, teamId))
        .get();
      if (!config?.event_key) continue;
      const matches = await gameMatches(env, config.event_key, teamId);
      await settleGameBets(db, teamId, config.event_key, matches);
      await settleGameParlays(db, teamId, config.event_key, matches);
    } catch (error) {
      console.error("[scouting] scheduled team work failed", teamId, error);
    }
  }
}

export const predictionsRoutes = new Hono<AppEnv>();
predictionsRoutes.get("/game", requireAuth, async (c) => {
  const settings = await getEngagementSettings(c.env.SCOUTING_DB, c.get("teamId"));
  if (!settings.enabled)
    return c.json({ error: "Scouting engagement is disabled for this team." }, 403);
  const now = Date.now();
  await dbOf(c)
    .insert(boylebucksAccounts)
    .values(
      withTeam(c.get("teamId"), {
        user_id: c.get("userId"),
        display_name: c.get("userDisplayName"),
        balance: 0,
        earned: 0,
        wagered: 0,
        updated_at: now,
      }),
    )
    .onConflictDoUpdate({
      target: [boylebucksAccounts.teamId, boylebucksAccounts.user_id],
      set: { display_name: sql`excluded.display_name`, updated_at: sql`excluded.updated_at` },
    })
    .run();
  const config = await first<{ event_key: string; current_match_number: number | null }>(
    dbOf(c),
    sql`SELECT event_key, current_match_number FROM (SELECT * FROM ${strategyEventConfig} WHERE ${inTeam(strategyEventConfig, c.get("teamId"))}) AS scoped_strategy_event_config WHERE id = 1`,
  );
  if (c.env.LOCAL_AUTH_BYPASS === "true" && config?.event_key === "local-demo") {
    const reference = `local-demo-credit:${c.get("userId")}`;
    await batch(dbOf(c), [
      dbOf(c)
        .update(boylebucksAccounts)
        .set({ balance: sql`balance + 250`, updated_at: now })
        .where(
          inTeam(
            boylebucksAccounts,
            c.get("teamId"),
            sql`user_id = ${c.get("userId")}
            AND NOT EXISTS (SELECT 1 FROM (SELECT * FROM ${boylebucksLedger} WHERE ${inTeam(boylebucksLedger, c.get("teamId"))}) AS scoped_boylebucks_ledger WHERE reference_id = ${reference})`,
          ),
        ),
      dbOf(c)
        .insert(boylebucksLedger)
        .values(
          withTeam(c.get("teamId"), {
            id: id("ledger"),
            user_id: c.get("userId"),
            amount: 250,
            reason: "Local prediction test points",
            reference_id: reference,
            created_at: now,
          }),
        )
        .onConflictDoNothing(),
    ]);
  }
  let matches: GameMatch[] = [];
  let statsError = "";
  if (settings.predictionsEnabled && config?.event_key) {
    try {
      matches = await gameMatches(c.env, config.event_key, c.get("teamId"));
      await settleGameBets(dbOf(c), c.get("teamId"), config.event_key, matches);
      await settleGameParlays(dbOf(c), c.get("teamId"), config.event_key, matches);
    } catch (error) {
      statsError = error instanceof Error ? error.message : "Statbotics is unavailable.";
    }
  }
  const account = await first<Record<string, number>>(
    dbOf(c),
    sql`SELECT balance, earned, wagered FROM (SELECT * FROM ${boylebucksAccounts} WHERE ${inTeam(boylebucksAccounts, c.get("teamId"))}) AS scoped_boylebucks_accounts WHERE user_id = ${c.get("userId")}`,
  );
  const leaderboard = settings.leaderboardEnabled
    ? await all<Record<string, unknown>>(
        dbOf(c),
        sql`SELECT display_name, balance, earned, wagered
       FROM (SELECT * FROM ${boylebucksAccounts} WHERE ${inTeam(boylebucksAccounts, c.get("teamId"))}) AS scoped_boylebucks_accounts
      ORDER BY balance DESC, earned DESC, display_name`,
      )
    : { results: [] };
  const bets = await all<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT id, match_key, match_label, market, selection, line, odds, stake, status, payout, placed_at
       FROM (SELECT * FROM ${gameBets} WHERE ${inTeam(gameBets, c.get("teamId"))}) AS scoped_game_bets WHERE user_id = ${c.get("userId")} ORDER BY placed_at DESC LIMIT 30`,
  );
  const parlayRows = await all<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT p.id, p.odds, p.stake, p.status, p.payout, p.placed_at,
            l.match_label, l.market, l.selection, l.line, l.odds AS leg_odds, l.status AS leg_status
       FROM (SELECT * FROM ${gameParlays} WHERE ${inTeam(gameParlays, c.get("teamId"))}) AS p
       JOIN (SELECT * FROM ${gameParlayLegs} WHERE ${inTeam(gameParlayLegs, c.get("teamId"))}) AS l ON l.parlay_id = p.id
      WHERE p.user_id = ${c.get("userId")}
        AND p.id IN (SELECT id FROM (SELECT * FROM ${gameParlays} WHERE ${inTeam(gameParlays, c.get("teamId"))}) AS scoped_game_parlays WHERE user_id = ${c.get("userId")} ORDER BY placed_at DESC LIMIT 20)
      ORDER BY p.placed_at DESC, l.match_label`,
  );
  const parlays = Array.from(
    parlayRows.results.reduce(
      (grouped, row) => {
        const parlayId = String(row.id);
        const existing = grouped.get(parlayId) ?? {
          id: parlayId,
          odds: Number(row.odds),
          stake: Number(row.stake),
          status: String(row.status),
          payout: Number(row.payout),
          placed_at: Number(row.placed_at),
          legs: [] as Record<string, unknown>[],
        };
        existing.legs.push({
          match_label: row.match_label,
          market: row.market,
          selection: row.selection,
          line: row.line,
          odds: row.leg_odds,
          status: row.leg_status,
        });
        grouped.set(parlayId, existing);
        return grouped;
      },
      new Map<
        string,
        {
          id: string;
          odds: number;
          stake: number;
          status: string;
          payout: number;
          placed_at: number;
          legs: Record<string, unknown>[];
        }
      >(),
    ),
  ).map(([, parlay]) => parlay);
  const currentMatchNumber = config?.current_match_number ?? 0;
  const availableMatches = matches
    .filter((match) => gameMatchIsOpen(match, now, currentMatchNumber))
    .slice(0, 18)
    .map((match) => {
      const line = gameLine(match);
      return {
        key: match.key,
        label: match.label,
        matchNumber: match.matchNumber,
        startTime: match.startTime,
        redTeams: match.redTeams,
        blueTeams: match.blueTeams,
        prediction: {
          redScore: Math.round(match.redScore * 10) / 10,
          blueScore: Math.round(match.blueScore * 10) / 10,
          redWinProbability: Math.round(match.redWinProbability * 1000) / 1000,
        },
        markets: {
          spread: {
            red: line.spread,
            blue: -line.spread,
            redOdds: -110,
            blueOdds: -110,
          },
        },
      };
    });
  return c.json({
    eventKey: config?.event_key ?? "",
    account: account ?? { balance: 0, earned: 0, wagered: 0 },
    settings,
    leaderboard: leaderboard.results,
    bets: settings.predictionsEnabled ? bets.results : [],
    parlays: settings.predictionsEnabled ? parlays : [],
    matches: availableMatches,
    statsError,
  });
});

predictionsRoutes.post("/game/bets", requireAuth, async (c) => {
  const settings = await getEngagementSettings(c.env.SCOUTING_DB, c.get("teamId"));
  if (!settings.enabled || !settings.predictionsEnabled)
    return c.json({ error: "Match predictions are disabled for this team." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const matchKey = text(body.matchKey, 100);
  const market = text(body.market, 20);
  const selection = text(body.selection, 20);
  const expectedLine = finiteNumber(body.expectedLine);
  const stake = Math.floor(finiteNumber(body.stake) ?? 0);
  if (!matchKey || market !== "spread")
    return c.json({ error: "Only score-adjusted match picks are available." }, 400);
  if (!["red", "blue"].includes(selection))
    return c.json({ error: "Choose a valid alliance pick." }, 400);
  if (stake < 1 || stake > 10_000)
    return c.json({ error: "Use between 1 and 10,000 points." }, 400);
  const config = await first<{ event_key: string; current_match_number: number | null }>(
    dbOf(c),
    sql`SELECT event_key, current_match_number FROM (SELECT * FROM ${strategyEventConfig} WHERE ${inTeam(strategyEventConfig, c.get("teamId"))}) AS scoped_strategy_event_config WHERE id = 1`,
  );
  if (!config?.event_key) return c.json({ error: "No event is configured." }, 409);
  let matches: GameMatch[];
  try {
    matches = await gameMatches(c.env, config.event_key, c.get("teamId"));
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Statbotics is unavailable." },
      503,
    );
  }
  const match = matches.find((candidate) => candidate.key === matchKey);
  if (!match || !gameMatchIsOpen(match, Date.now(), config.current_match_number ?? 0))
    return c.json({ error: "That match is no longer open for predictions." }, 409);
  const account = await first<{ balance: number }>(
    dbOf(c),
    sql`SELECT balance FROM (SELECT * FROM ${boylebucksAccounts} WHERE ${inTeam(boylebucksAccounts, c.get("teamId"))}) AS scoped_boylebucks_accounts WHERE user_id = ${c.get("userId")}`,
  );
  if (!account || account.balance < stake)
    return c.json({ error: "You do not have enough points." }, 409);
  const line = gameLine(match);
  const betLine = line.spread;
  const selectedLine = selection === "red" ? betLine : -betLine;
  if (expectedLine === null || Math.abs(expectedLine - selectedLine) > 1e-9)
    return c.json({ error: "The score adjustment changed. Refresh and choose again." }, 409);
  const odds = -110;
  const betId = id("bet");
  const placedAt = Date.now();
  try {
    await batch(dbOf(c), [
      dbOf(c)
        .insert(gameBets)
        .values(
          withTeam(c.get("teamId"), {
            id: betId,
            user_id: c.get("userId"),
            user_name: c.get("userDisplayName"),
            event_key: config.event_key,
            match_key: match.key,
            match_label: match.label,
            market: market,
            selection: selection,
            line: betLine,
            odds: odds,
            stake: stake,
            status: "open",
            payout: 0,
            placed_at: placedAt,
          }),
        ),
      dbOf(c)
        .update(boylebucksAccounts)
        .set({
          balance: sql`balance - ${stake}`,
          wagered: sql`wagered + ${stake}`,
          display_name: c.get("userDisplayName"),
          updated_at: placedAt,
        })
        .where(
          inTeam(
            boylebucksAccounts,
            c.get("teamId"),
            sql`user_id = ${c.get("userId")} AND balance >= ${stake}`,
          ),
        ),
      dbOf(c)
        .insert(boylebucksLedger)
        .values(
          withTeam(c.get("teamId"), {
            id: id("ledger"),
            user_id: c.get("userId"),
            amount: -stake,
            reason: "Prediction submitted",
            reference_id: `wager:${betId}`,
            created_at: placedAt,
          }),
        ),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      return c.json({ error: "You already submitted this type of pick for that match." }, 409);
    if (String(error).includes("insufficient BoyleBucks"))
      return c.json({ error: "You do not have enough points." }, 409);
    throw error;
  }
  return c.json({ ok: true, betId }, 201);
});

predictionsRoutes.post("/game/parlays", requireAuth, async (c) => {
  const settings = await getEngagementSettings(c.env.SCOUTING_DB, c.get("teamId"));
  if (!settings.enabled || !settings.predictionsEnabled)
    return c.json({ error: "Match predictions are disabled for this team." }, 403);
  if (!settings.combinationsEnabled)
    return c.json({ error: "Combined picks are disabled for this team." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const inputs = Array.isArray(body.legs) ? body.legs.slice(0, 9) : [];
  const stake = Math.floor(finiteNumber(body.stake) ?? 0);
  if (inputs.length < 2 || inputs.length > 8)
    return c.json({ error: "A combined pick needs 2 to 8 matches." }, 400);
  if (stake < 1 || stake > 10_000)
    return c.json({ error: "Use between 1 and 10,000 points." }, 400);
  const requested = inputs.map((input) => {
    const leg = record(input);
    return {
      matchKey: text(leg.matchKey, 100),
      market: text(leg.market, 20),
      selection: text(leg.selection, 20),
      expectedLine: finiteNumber(leg.expectedLine),
    };
  });
  if (new Set(requested.map((leg) => leg.matchKey)).size !== requested.length)
    return c.json({ error: "Choose only one pick from each match in a combination." }, 400);
  if (
    requested.some(
      (leg) =>
        !leg.matchKey ||
        leg.market !== "spread" ||
        !["red", "blue"].includes(leg.selection) ||
        leg.expectedLine === null,
    )
  )
    return c.json({ error: "One or more combined picks are invalid." }, 400);
  const config = await first<{ event_key: string; current_match_number: number | null }>(
    dbOf(c),
    sql`SELECT event_key, current_match_number FROM (SELECT * FROM ${strategyEventConfig} WHERE ${inTeam(strategyEventConfig, c.get("teamId"))}) AS scoped_strategy_event_config WHERE id = 1`,
  );
  if (!config?.event_key) return c.json({ error: "No event is configured." }, 409);
  let matches: GameMatch[];
  try {
    matches = await gameMatches(c.env, config.event_key, c.get("teamId"));
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Statbotics is unavailable." },
      503,
    );
  }
  const now = Date.now();
  for (const request of requested) {
    const match = matches.find((candidate) => candidate.key === request.matchKey);
    if (!match || !gameMatchIsOpen(match, now, config.current_match_number ?? 0))
      return c.json(
        { error: `${match?.label ?? "A match"} is no longer open for predictions.` },
        409,
      );
    const currentLine = gameLine(match).spread;
    const selectedLine = request.selection === "red" ? currentLine : -currentLine;
    if (Math.abs((request.expectedLine as number) - selectedLine) > 1e-9)
      return c.json(
        { error: `${match.label}'s score adjustment changed. Refresh your picks.` },
        409,
      );
  }
  const matchMap = new Map(matches.map((match) => [match.key, match]));
  const legs = requested.map((request) => {
    const match = matchMap.get(request.matchKey);
    if (!match) throw new Error("Validated parlay match is missing.");
    const calculated = gameLine(match);
    return {
      ...request,
      match,
      line: calculated.spread,
      odds: -110,
    };
  });
  const usedTeams = new Set<string>();
  for (const leg of legs) {
    const teams = [...leg.match.redTeams, ...leg.match.blueTeams];
    if (teams.some((team) => usedTeams.has(team)))
      return c.json({ error: "Combined picks cannot contain the same team more than once." }, 400);
    for (const team of teams) usedTeams.add(team);
  }
  const account = await first<{ balance: number }>(
    dbOf(c),
    sql`SELECT balance FROM (SELECT * FROM ${boylebucksAccounts} WHERE ${inTeam(boylebucksAccounts, c.get("teamId"))}) AS scoped_boylebucks_accounts WHERE user_id = ${c.get("userId")}`,
  );
  if (!account || account.balance < stake)
    return c.json({ error: "You do not have enough points." }, 409);
  const parlayId = id("parlay");
  const odds = combinedAmericanOdds(legs.map((leg) => leg.odds));
  const statements: WriteQuery[] = [
    dbOf(c)
      .insert(gameParlays)
      .values(
        withTeam(c.get("teamId"), {
          id: parlayId,
          user_id: c.get("userId"),
          user_name: c.get("userDisplayName"),
          event_key: config.event_key,
          odds: odds,
          stake: stake,
          status: "open",
          payout: 0,
          placed_at: now,
        }),
      ),
    ...legs.map((leg) =>
      dbOf(c)
        .insert(gameParlayLegs)
        .values(
          withTeam(c.get("teamId"), {
            id: id("leg"),
            parlay_id: parlayId,
            match_key: leg.match.key,
            match_label: leg.match.label,
            market: leg.market,
            selection: leg.selection,
            line: leg.line,
            odds: leg.odds,
            status: "open",
          }),
        ),
    ),
    dbOf(c)
      .update(boylebucksAccounts)
      .set({ balance: sql`balance - ${stake}`, wagered: sql`wagered + ${stake}`, updated_at: now })
      .where(
        inTeam(
          boylebucksAccounts,
          c.get("teamId"),
          sql`user_id = ${c.get("userId")} AND balance >= ${stake}`,
        ),
      ),
    dbOf(c)
      .insert(boylebucksLedger)
      .values(
        withTeam(c.get("teamId"), {
          id: id("ledger"),
          user_id: c.get("userId"),
          amount: -stake,
          reason: "Combined pick submitted",
          reference_id: `wager:${parlayId}`,
          created_at: now,
        }),
      ),
  ];
  try {
    await batch(dbOf(c), statements);
  } catch (error) {
    if (String(error).includes("insufficient BoyleBucks"))
      return c.json({ error: "You do not have enough points." }, 409);
    throw error;
  }
  return c.json({ ok: true, parlayId, odds }, 201);
});
