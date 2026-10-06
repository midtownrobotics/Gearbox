import { corsOrigin, site, teamKey } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { sendDM } from "@g3/slack";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { getEngagementSettings, parseEngagementSettings } from "./engagement";
import { requireAuth } from "./middleware/auth";
import type { AppEnv } from "./types";

/** "Our team" for a request: the team the gateway says the page is for (the site team without it). */
const ourTeam = (c: { req: { header(name: string): string | undefined } }) =>
  c.req.header("X-Team-Id") ?? teamKey;

type Tier = { id: string; name: string; color: string; items: string[] };
type TierListInput = { name?: unknown; description?: unknown; tiers?: unknown };
type ScoutingField = {
  id: string;
  label: string;
  caption?: string;
  type: "shortText" | "longText" | "mcq" | "slider" | "fieldMap" | "multiSelect" | "counter";
  required: boolean;
  options: string[];
  min: number;
  max: number;
  step: number;
};
type G3IdUser = {
  id: string;
  email: string;
  displayName: string;
  status: "pending" | "active" | "rejected" | "merged";
  slackUserId?: string;
};
type TbaMatch = {
  key: string;
  comp_level: string;
  set_number: number;
  match_number: number;
  time: number | null;
  predicted_time: number | null;
  actual_time: number | null;
  post_result_time?: number | null;
  alliances: {
    red: { team_keys: string[]; score: number };
    blue: { team_keys: string[]; score: number };
  };
};
type TbaTeam = { key: string; team_number: number; nickname: string | null; name: string };
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
const app = new Hono<AppEnv>();

app.onError((error, c) => {
  console.error("[scouting]", error);
  return c.json({ error: "Internal server error." }, 500);
});

app.use(
  "*",
  cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    credentials: true,
  }),
);

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function text(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const MAX_FRC_TEAM_NUMBER = 12_000;

function teamNumber(value: unknown, enforceMaximum = true) {
  const source =
    value && typeof value === "object"
      ? ((value as Record<string, unknown>).team_number ??
        (value as Record<string, unknown>).teamNumber ??
        (value as Record<string, unknown>).team ??
        (value as Record<string, unknown>).number)
      : value;
  const raw =
    typeof source === "number" && Number.isInteger(source) ? String(source) : text(source, 40);
  const candidate = raw.match(/\d{1,6}/)?.[0] ?? "";
  if (
    !candidate ||
    Number(candidate) < 1 ||
    (enforceMaximum && Number(candidate) > MAX_FRC_TEAM_NUMBER)
  )
    return "";
  return String(Number(candidate));
}

function stringArray(value: unknown, maxItems = 100) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => text(item, 300))
    .filter(Boolean);
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === "string" ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function nested(value: unknown, ...path: string[]) {
  let current: unknown = value;
  for (const key of path) current = record(current)[key];
  return current;
}

function nonZeroEntry(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim() !== "" && Number(value.trim()) !== 0;
  if (Array.isArray(value)) return value.length > 0 && value.every(nonZeroEntry);
  return false;
}

function validScoutingEntry(field: ScoutingField, value: unknown) {
  if (field.type === "slider" || field.type === "counter") {
    const numeric = finiteNumber(value);
    const min = Number.isFinite(field.min) ? field.min : 0;
    const max = Number.isFinite(field.max) ? field.max : 10;
    const step = Number.isFinite(field.step) && field.step > 0 ? field.step : 1;
    if (numeric === null || numeric === 0 || numeric < min || numeric > max) return false;
    if (field.type === "counter" && !Number.isInteger(numeric)) return false;
    const steps = (numeric - min) / step;
    return Math.abs(steps - Math.round(steps)) < 1e-9;
  }
  if (field.type === "mcq")
    return typeof value === "string" && field.options.includes(value) && nonZeroEntry(value);
  if (field.type === "multiSelect") {
    const selected = stringArray(value, 30);
    return (
      selected.length > 0 &&
      selected.every((option) => field.options.includes(option) && nonZeroEntry(option))
    );
  }
  return nonZeroEntry(value);
}

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

function localDemoGameMatches(): GameMatch[] {
  const now = Date.now();
  return [
    {
      redTeams: [String(site.team.number), "1771", "2974"],
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
      redTeams: [String(site.team.number), "4188", "6829"],
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

async function gameMatches(env: AppEnv["Bindings"], eventKey: string) {
  if (env.LOCAL_AUTH_BYPASS === "true" && eventKey === "local-demo") return localDemoGameMatches();
  return getStatboticsMatches(eventKey);
}

async function settleGameBets(db: D1Database, eventKey: string, matches: GameMatch[]) {
  const completed = new Map(
    matches
      .filter((match) => match.actualRedScore !== null && match.actualBlueScore !== null)
      .map((match) => [match.key, match]),
  );
  if (!completed.size) return;
  const open = await db
    .prepare(
      "SELECT id, user_id, match_key, market, selection, line, odds, stake FROM game_bets WHERE event_key = ? AND status = 'open'",
    )
    .bind(eventKey)
    .all<Record<string, unknown>>();
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
    const statements = [
      db
        .prepare(
          "UPDATE game_bets SET status = ?, payout = ?, settled_at = ? WHERE id = ? AND status = 'open'",
        )
        .bind(status, payout, now, bet.id),
    ];
    if (payout > 0) {
      statements.push(
        db
          .prepare(
            `UPDATE boylebucks_accounts
              SET balance = balance + ?, updated_at = ?
            WHERE user_id = ?
              AND EXISTS (
                SELECT 1 FROM game_bets
                 WHERE id = ? AND status = ? AND settled_at = ?
              )
              AND NOT EXISTS (
                SELECT 1 FROM boylebucks_ledger WHERE reference_id = ?
              )`,
          )
          .bind(payout, now, bet.user_id, bet.id, status, now, `bet:${bet.id}`),
        db
          .prepare(
            "INSERT OR IGNORE INTO boylebucks_ledger (id, user_id, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            id("ledger"),
            bet.user_id,
            payout,
            status === "push" ? "Bet refunded" : "Bet won",
            `bet:${bet.id}`,
            now,
          ),
      );
    }
    await db.batch(statements);
  }
}

async function settleGameParlays(db: D1Database, eventKey: string, matches: GameMatch[]) {
  const matchMap = new Map(matches.map((match) => [match.key, match]));
  const open = await db
    .prepare(
      `SELECT p.id, p.user_id, p.stake, l.id AS leg_id, l.match_key, l.market,
            l.selection, l.line, l.odds, l.status
       FROM game_parlays p
       JOIN game_parlay_legs l ON l.parlay_id = p.id
      WHERE p.event_key = ? AND p.status = 'open'
      ORDER BY p.id`,
    )
    .bind(eventKey)
    .all<Record<string, unknown>>();
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of open.results)
    grouped.set(String(row.id), [...(grouped.get(String(row.id)) ?? []), row]);
  for (const [parlayId, legs] of Array.from(grouped.entries())) {
    const updates: D1PreparedStatement[] = [];
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
            .prepare("UPDATE game_parlay_legs SET status = ? WHERE id = ? AND status = 'open'")
            .bind(result, leg.leg_id),
        );
      return result;
    });
    if (updates.length) await db.batch(updates);
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
    const statements = [
      db
        .prepare(
          "UPDATE game_parlays SET status = ?, payout = ?, settled_at = ? WHERE id = ? AND status = 'open'",
        )
        .bind(finalStatus, payout, now, parlayId),
    ];
    if (payout > 0) {
      statements.push(
        db
          .prepare(
            `UPDATE boylebucks_accounts
              SET balance = balance + ?, updated_at = ?
            WHERE user_id = ?
              AND EXISTS (SELECT 1 FROM game_parlays WHERE id = ? AND settled_at = ?)
              AND NOT EXISTS (SELECT 1 FROM boylebucks_ledger WHERE reference_id = ?)`,
          )
          .bind(payout, now, legs[0].user_id, parlayId, now, `parlay:${parlayId}`),
        db
          .prepare(
            "INSERT OR IGNORE INTO boylebucks_ledger (id, user_id, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            id("ledger"),
            legs[0].user_id,
            payout,
            finalStatus === "push" ? "Parlay refunded" : "Parlay won",
            `parlay:${parlayId}`,
            now,
          ),
      );
    }
    await db.batch(statements);
  }
}

async function settleConfiguredGame(env: AppEnv["Bindings"]) {
  const settings = await getEngagementSettings(env.SCOUTING_DB);
  if (!settings.enabled || !settings.predictionsEnabled) return;
  const config = await env.SCOUTING_DB.prepare(
    "SELECT event_key FROM strategy_event_config WHERE id = 1",
  ).first<{ event_key: string }>();
  if (!config?.event_key) return;
  const matches = await gameMatches(env, config.event_key);
  await settleGameBets(env.SCOUTING_DB, config.event_key, matches);
  await settleGameParlays(env.SCOUTING_DB, config.event_key, matches);
}

function firstJsonObject(value: string) {
  const start = value.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return value.slice(start, index + 1);
  }
  return "";
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} timed out; try a smaller image`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

app.get("/health", (c) =>
  c.json({ status: "ok", service: "scouting", version: packageJson.version }),
);
async function isStrategyAdmin(c: Context<AppEnv>) {
  if (c.get("userIsAdmin")) return true;
  const row = await c.env.SCOUTING_DB.prepare(
    "SELECT user_id FROM strategy_admins WHERE user_id = ?",
  )
    .bind(c.get("userId"))
    .first();
  return Boolean(row);
}

async function isServiceHelper(c: Context<AppEnv>) {
  const row = await c.env.SCOUTING_DB.prepare(
    "SELECT user_id FROM service_helpers WHERE user_id = ?",
  )
    .bind(c.get("userId"))
    .first();
  return Boolean(row);
}

app.get("/me", requireAuth, async (c) =>
  c.json({
    userId: c.get("userId"),
    displayName: c.get("userDisplayName"),
    email: c.get("userEmail"),
    isAdmin: await isStrategyAdmin(c),
    isG3IdAdmin: c.get("userIsAdmin"),
    isHelper: await isServiceHelper(c),
    engagement: await getEngagementSettings(c.env.SCOUTING_DB),
  }),
);

function matchOrder(match: TbaMatch) {
  const level = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 }[match.comp_level] ?? 5;
  return level * 100_000 + match.set_number * 1_000 + match.match_number;
}

function matchLabel(match: TbaMatch) {
  if (match.comp_level === "qm") return `Qualification ${match.match_number}`;
  const level = { ef: "Eighthfinal", qf: "Quarterfinal", sf: "Semifinal", f: "Final" }[
    match.comp_level
  ];
  return `${level ?? match.comp_level.toUpperCase()} ${match.set_number}-${match.match_number}`;
}

function publicMatch(match: TbaMatch) {
  const scheduledTime = match.predicted_time ?? match.time;
  const redTeams = match.alliances.red.team_keys.map((team) => team.replace(/^frc/, ""));
  const blueTeams = match.alliances.blue.team_keys.map((team) => team.replace(/^frc/, ""));
  return {
    key: match.key,
    label: matchLabel(match),
    matchNumber: match.match_number,
    compLevel: match.comp_level,
    scheduledAt: scheduledTime ? scheduledTime * 1000 : null,
    teams: [...redTeams, ...blueTeams],
    redTeams,
    blueTeams,
  };
}

function automaticTbaMatch(matches: TbaMatch[], now = Math.floor(Date.now() / 1000)) {
  const qualifications = matches
    .filter((match) => match.comp_level === "qm")
    .sort((left, right) => matchOrder(left) - matchOrder(right));
  const ordered = qualifications.length
    ? qualifications
    : [...matches].sort((left, right) => matchOrder(left) - matchOrder(right));
  if (!ordered.length) return undefined;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const match = ordered[index];
    const hasResult = match.alliances.red.score >= 0 && match.alliances.blue.score >= 0;
    const endedAt =
      match.post_result_time ??
      (match.actual_time ? match.actual_time + 150 : null) ??
      (hasResult ? (match.predicted_time ?? match.time ?? 0) + 150 : null);
    if (!endedAt || now < endedAt + 60) return match;
  }
  return ordered.at(-1);
}

async function persistAutomaticMatch(
  c: Context<AppEnv>,
  configuredMatchNumber: number | null | undefined,
  match: TbaMatch | undefined,
) {
  if (!match || match.comp_level !== "qm" || match.match_number === configuredMatchNumber) return;
  await c.env.SCOUTING_DB.prepare(
    "UPDATE strategy_event_config SET current_match_number = ?, updated_at = ? WHERE id = 1 AND schedule_mode = 'tba'",
  )
    .bind(match.match_number, Date.now())
    .run();
}

async function getOrCreateScoutAssignment(
  c: Context<AppEnv>,
  eventKey: string,
  matchNumber: number,
  teams: string[],
) {
  const existing = await c.env.SCOUTING_DB.prepare(
    "SELECT team_number FROM scouting_match_assignments WHERE event_key = ? AND match_number = ? AND user_id = ?",
  )
    .bind(eventKey, matchNumber, c.get("userId"))
    .first<{ team_number: string }>();
  if (existing && teams.includes(existing.team_number)) return existing.team_number;

  const submitted = await c.env.SCOUTING_DB.prepare(
    `SELECT s.team_name
       FROM scouting_form_submissions s
       JOIN scouting_forms f ON f.id = s.form_id
      WHERE f.form_kind = 'scouting' AND s.submitted_by = ?
        AND s.event_key = ? AND s.match_number = ? AND s.archived_at IS NULL
      LIMIT 1`,
  )
    .bind(c.get("userId"), eventKey, matchNumber)
    .first<{ team_name: string }>();
  if (submitted) return submitted.team_name;

  if (!teams.length) return null;
  const assignedCounts = await c.env.SCOUTING_DB.prepare(
    `SELECT team_number, COUNT(*) AS assignment_count
       FROM scouting_match_assignments
      WHERE event_key = ? AND match_number = ?
      GROUP BY team_number`,
  )
    .bind(eventKey, matchNumber)
    .all<{ team_number: string; assignment_count: number }>();
  const counts = new Map(
    assignedCounts.results.map((row) => [row.team_number, Number(row.assignment_count)]),
  );
  const team = teams.reduce((best, candidate) =>
    (counts.get(candidate) ?? 0) < (counts.get(best) ?? 0) ? candidate : best,
  );
  await c.env.SCOUTING_DB.prepare(
    `INSERT OR IGNORE INTO scouting_match_assignments
       (event_key, match_number, user_id, team_number, assigned_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(eventKey, matchNumber, c.get("userId"), team, Date.now())
    .run();
  return (
    (
      await c.env.SCOUTING_DB.prepare(
        "SELECT team_number FROM scouting_match_assignments WHERE event_key = ? AND match_number = ? AND user_id = ?",
      )
        .bind(eventKey, matchNumber, c.get("userId"))
        .first<{ team_number: string }>()
    )?.team_number ?? null
  );
}

async function getTbaAuthKey(c: Context<AppEnv>) {
  const config = await c.env.SCOUTING_DB.prepare(
    "SELECT tba_auth_key FROM strategy_event_config WHERE id = 1",
  ).first<{ tba_auth_key: string | null }>();
  return config?.tba_auth_key || c.env.TBA_AUTH_KEY || "";
}

async function validateTbaConfiguration(eventKey: string, authKey: string) {
  if (!authKey) throw new Error("TBA authentication key is not configured.");
  const response = await fetch(
    `https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(eventKey)}/simple`,
    { headers: { "X-TBA-Auth-Key": authKey } },
  );
  if (response.ok) return;
  if (response.status === 401 || response.status === 403)
    throw new Error("TBA rejected the authentication key. Check the key and try again.");
  if (response.status === 404)
    throw new Error(`TBA could not find event ${eventKey}. Check the event key and try again.`);
  throw new Error(`The Blue Alliance returned ${response.status}. Try again shortly.`);
}

async function getTbaMatches(c: Context<AppEnv>, eventKey: string) {
  const now = Date.now();
  const cached = await c.env.SCOUTING_DB.prepare(
    "SELECT matches_json FROM tba_match_cache WHERE event_key = ? AND expires_at > ?",
  )
    .bind(eventKey, now)
    .first<{ matches_json: string }>();
  if (cached) return parseJson<TbaMatch[]>(cached.matches_json, []);
  const tbaAuthKey = await getTbaAuthKey(c);
  if (!tbaAuthKey) throw new Error("TBA authentication key is not configured.");
  const response = await fetch(
    `https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(eventKey)}/matches`,
    { headers: { "X-TBA-Auth-Key": tbaAuthKey } },
  );
  if (!response.ok) throw new Error(`The Blue Alliance returned ${response.status}.`);
  const matches = (await response.json()) as TbaMatch[];
  await c.env.SCOUTING_DB.prepare(
    "INSERT OR REPLACE INTO tba_match_cache (event_key, matches_json, expires_at) VALUES (?, ?, ?)",
  )
    .bind(eventKey, JSON.stringify(matches), now + 30_000)
    .run();
  return matches;
}

async function purgeExpiredManualEvents(c: Context<AppEnv>) {
  const expired = await c.env.SCOUTING_DB.prepare(
    "SELECT event_key FROM manual_events WHERE delete_after <= ?",
  )
    .bind(Date.now())
    .all<{ event_key: string }>();
  for (const row of expired.results) {
    await c.env.SCOUTING_DB.batch([
      c.env.SCOUTING_DB.prepare("DELETE FROM manual_matches WHERE event_key = ?").bind(
        row.event_key,
      ),
      c.env.SCOUTING_DB.prepare("DELETE FROM manual_teams WHERE event_key = ?").bind(row.event_key),
      c.env.SCOUTING_DB.prepare("DELETE FROM manual_events WHERE event_key = ?").bind(
        row.event_key,
      ),
      c.env.SCOUTING_DB.prepare(
        "UPDATE strategy_event_config SET event_key = '', current_match_number = NULL, schedule_mode = 'tba', updated_at = ? WHERE event_key = ? AND schedule_mode = 'manual'",
      ).bind(Date.now(), row.event_key),
    ]);
  }
}

async function getManualMatches(c: Context<AppEnv>, eventKey: string) {
  await purgeExpiredManualEvents(c);
  const rows = await c.env.SCOUTING_DB.prepare(
    `SELECT match_key, comp_level, set_number, match_number, scheduled_at,
            red_1, red_2, red_3, blue_1, blue_2, blue_3
       FROM manual_matches WHERE event_key = ? ORDER BY match_number`,
  )
    .bind(eventKey)
    .all<Record<string, unknown>>();
  return rows.results.map<TbaMatch>((row) => ({
    key: String(row.match_key),
    comp_level: String(row.comp_level),
    set_number: Number(row.set_number),
    match_number: Number(row.match_number),
    time: row.scheduled_at ? Math.floor(Number(row.scheduled_at) / 1000) : null,
    predicted_time: null,
    actual_time: null,
    alliances: {
      red: { team_keys: [row.red_1, row.red_2, row.red_3].map((n) => `frc${n}`), score: -1 },
      blue: { team_keys: [row.blue_1, row.blue_2, row.blue_3].map((n) => `frc${n}`), score: -1 },
    },
  }));
}

async function getEventMatches(c: Context<AppEnv>, eventKey: string, mode?: string) {
  let scheduleMode = mode;
  if (!scheduleMode) {
    const config = await c.env.SCOUTING_DB.prepare(
      "SELECT schedule_mode FROM strategy_event_config WHERE id = 1",
    ).first<{ schedule_mode: string }>();
    scheduleMode = config?.schedule_mode;
  }
  return scheduleMode === "manual" ? getManualMatches(c, eventKey) : getTbaMatches(c, eventKey);
}

async function getTbaTeams(c: Context<AppEnv>, eventKey: string) {
  const now = Date.now();
  const cached = await c.env.SCOUTING_DB.prepare(
    "SELECT teams_json FROM tba_team_cache WHERE event_key = ? AND expires_at > ?",
  )
    .bind(eventKey, now)
    .first<{ teams_json: string }>();
  if (cached) return parseJson<TbaTeam[]>(cached.teams_json, []);
  const tbaAuthKey = await getTbaAuthKey(c);
  if (!tbaAuthKey) throw new Error("TBA authentication key is not configured.");
  const response = await fetch(
    `https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(eventKey)}/teams/simple`,
    { headers: { "X-TBA-Auth-Key": tbaAuthKey } },
  );
  if (!response.ok) throw new Error(`The Blue Alliance returned ${response.status}.`);
  const teams = (await response.json()) as TbaTeam[];
  await c.env.SCOUTING_DB.prepare(
    "INSERT OR REPLACE INTO tba_team_cache (event_key, teams_json, expires_at) VALUES (?, ?, ?)",
  )
    .bind(eventKey, JSON.stringify(teams), now + 3_600_000)
    .run();
  return teams;
}

app.get("/teams/search", requireAuth, async (c) => {
  const query = text(c.req.query("q"), 80).toLowerCase();
  if (!query) return c.json({ teams: [], message: null });
  const config = await c.env.SCOUTING_DB.prepare(
    "SELECT event_key, schedule_mode FROM strategy_event_config WHERE id = 1",
  ).first<{ event_key: string; schedule_mode: string }>();
  if (!config?.event_key)
    return c.json({ teams: [], message: "Set the TBA event key in Scouting Forms first." });
  try {
    const sourceTeams =
      config.schedule_mode === "manual"
        ? (
            await c.env.SCOUTING_DB.prepare(
              "SELECT team_number, team_name FROM manual_teams WHERE event_key = ?",
            )
              .bind(config.event_key)
              .all<{ team_number: string; team_name: string }>()
          ).results.map((team) => ({
            key: `frc${team.team_number}`,
            team_number: Number(team.team_number),
            nickname: team.team_name,
            name: team.team_name,
          }))
        : await getTbaTeams(c, config.event_key);
    const teams = sourceTeams
      .filter((team) => {
        const number = String(team.team_number);
        const name = (team.nickname || team.name || "").toLowerCase();
        return number.includes(query) || name.includes(query);
      })
      .sort((left, right) => {
        const leftNumber = String(left.team_number);
        const rightNumber = String(right.team_number);
        const leftExact = leftNumber === query ? 0 : leftNumber.startsWith(query) ? 1 : 2;
        const rightExact = rightNumber === query ? 0 : rightNumber.startsWith(query) ? 1 : 2;
        return leftExact - rightExact || left.team_number - right.team_number;
      })
      .slice(0, 8)
      .map((team) => ({ number: String(team.team_number), name: team.nickname || team.name }));
    return c.json({ teams, message: teams.length ? null : "No matching teams at this event." });
  } catch (error) {
    return c.json({
      teams: [],
      message: error instanceof Error ? error.message : "Could not load event teams.",
    });
  }
});

async function resolveEventLink(c: Context<AppEnv>) {
  const config = await c.env.SCOUTING_DB.prepare(
    "SELECT event_key, current_match_number, tba_auth_key, schedule_mode FROM strategy_event_config WHERE id = 1",
  ).first<{
    event_key: string;
    current_match_number: number | null;
    tba_auth_key: string | null;
    schedule_mode: string;
  }>();
  if (!config?.event_key) return { eventKey: null, matchKey: null, matchNumber: null };
  let current: TbaMatch | undefined;
  try {
    const matches = (await getEventMatches(c, config.event_key)).sort(
      (a, b) => matchOrder(a) - matchOrder(b),
    );
    current =
      config.schedule_mode === "manual"
        ? matches.find(
            (match) =>
              match.comp_level === "qm" && match.match_number === config.current_match_number,
          )
        : automaticTbaMatch(matches);
    if (config.schedule_mode !== "manual")
      await persistAutomaticMatch(c, config.current_match_number, current);
  } catch {
    // Keep the configured event link when TBA is temporarily unavailable.
  }
  return {
    eventKey: config.event_key,
    matchKey: current?.key ?? null,
    matchNumber: current?.match_number ?? config.current_match_number,
  };
}

app.get("/event-context", requireAuth, async (c) => {
  const admin = await isStrategyAdmin(c);
  const now = Date.now();
  const config = await c.env.SCOUTING_DB.prepare(
    "SELECT event_key, current_match_number, tba_auth_key, nexus_event_key, nexus_api_key, schedule_mode FROM strategy_event_config WHERE id = 1",
  ).first<{
    event_key: string;
    current_match_number: number | null;
    tba_auth_key: string | null;
    nexus_event_key: string | null;
    nexus_api_key: string | null;
    schedule_mode: string;
  }>();
  const eventKey = config?.event_key ?? "";
  let matches: TbaMatch[] = [];
  let scheduleError = "";
  if (eventKey) {
    try {
      matches = (await getEventMatches(c, eventKey, config?.schedule_mode)).sort(
        (a, b) => matchOrder(a) - matchOrder(b),
      );
    } catch (error) {
      scheduleError = error instanceof Error ? error.message : "Could not load the TBA schedule.";
    }
  }
  const configuredCurrent = config?.current_match_number
    ? matches.find(
        (match) => match.comp_level === "qm" && match.match_number === config.current_match_number,
      )
    : undefined;
  const tbaCurrent = config?.schedule_mode === "manual" ? undefined : automaticTbaMatch(matches);
  const current =
    (config?.schedule_mode === "manual" ? configuredCurrent : tbaCurrent) ??
    configuredCurrent ??
    (config?.schedule_mode === "manual" ? matches[0] : matches.at(-1));
  if (config?.schedule_mode !== "manual")
    await persistAutomaticMatch(c, config?.current_match_number, current);
  const teamSchedule = matches.filter((match) =>
    [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys].includes(ourTeam(c)),
  );
  const nextTeamMatch = current
    ? teamSchedule.find((match) => matchOrder(match) >= matchOrder(current))
    : teamSchedule[0];
  const onlineAdmins = admin
    ? await c.env.SCOUTING_DB.prepare(
        "SELECT user_id, display_name, last_seen_at FROM strategy_presence WHERE is_admin = 1 AND last_seen_at >= ? ORDER BY display_name",
      )
        .bind(now - 90_000)
        .all<Record<string, unknown>>()
    : null;
  const currentMatchNumber = current?.match_number ?? config?.current_match_number ?? null;
  const eventMatchSubmissions = eventKey
    ? await c.env.SCOUTING_DB.prepare(
        `SELECT s.id, s.submitted_by, s.submitted_by_name, s.team_name, s.created_at,
                  s.match_number, s.match_key
           FROM scouting_form_submissions s
           JOIN scouting_forms f ON f.id = s.form_id
           WHERE f.form_kind = 'scouting' AND s.event_key = ?
             AND s.archived_at IS NULL
           ORDER BY s.match_number, s.created_at`,
      )
        .bind(eventKey)
        .all<Record<string, unknown>>()
    : null;
  const currentMatchSubmissions = (eventMatchSubmissions?.results ?? []).filter(
    (row) => Number(row.match_number) === currentMatchNumber,
  );
  const submittedUserIds = new Set(currentMatchSubmissions.map((row) => String(row.submitted_by)));
  const onlineScouts = current
    ? await c.env.SCOUTING_DB.prepare(
        `SELECT user_id, display_name, last_seen_at
         FROM strategy_presence
         WHERE current_page = 'forms' AND last_seen_at >= ?
         ORDER BY user_id`,
      )
        .bind(now - 75_000)
        .all<Record<string, unknown>>()
    : null;
  const activeScoutIds = (onlineScouts?.results ?? [])
    .map((row) => String(row.user_id))
    .filter((userId) => !submittedUserIds.has(userId));
  if (!submittedUserIds.has(c.get("userId")) && !activeScoutIds.includes(c.get("userId"))) {
    activeScoutIds.push(c.get("userId"));
    activeScoutIds.sort();
  }
  const assignedTeam =
    c.req.query("assign") === "true" && current && eventKey && currentMatchNumber
      ? await getOrCreateScoutAssignment(
          c,
          eventKey,
          currentMatchNumber,
          publicMatch(current).teams,
        )
      : null;
  return c.json({
    eventKey: admin ? eventKey : "",
    currentMatchNumber: admin ? currentMatchNumber : null,
    currentMatch: current ? publicMatch(current) : null,
    tbaCurrentMatch: tbaCurrent ? publicMatch(tbaCurrent) : null,
    assignedTeam,
    hasSubmittedCurrentMatch: submittedUserIds.has(c.get("userId")),
    onlineScoutCount: activeScoutIds.length,
    matchSubmissions: admin ? (eventMatchSubmissions?.results ?? []) : [],
    nextTeamMatch: nextTeamMatch ? publicMatch(nextTeamMatch) : null,
    teamSchedule: admin ? teamSchedule.map(publicMatch) : [],
    eventSchedule: admin ? matches.map(publicMatch) : [],
    onlineAdmins: onlineAdmins?.results ?? [],
    scheduleError: admin ? scheduleError : "",
    hasTbaAuthKey: admin ? Boolean(config?.tba_auth_key || c.env.TBA_AUTH_KEY) : false,
    tbaAuthKey: "",
    nexusEventKey: admin ? config?.nexus_event_key || eventKey : "",
    hasNexusApiKey: admin ? Boolean(config?.nexus_api_key || c.env.NEXUS_API_KEY) : false,
    nexusApiKey: "",
    scheduleMode: admin ? config?.schedule_mode || "tba" : config?.schedule_mode || "tba",
    manualEvent:
      admin && config?.schedule_mode === "manual"
        ? await c.env.SCOUTING_DB.prepare(
            "SELECT event_name, ends_at, delete_after FROM manual_events WHERE event_key = ?",
          )
            .bind(eventKey)
            .first()
        : null,
    manualTeamNames:
      admin && config?.schedule_mode === "manual"
        ? Object.fromEntries(
            (
              await c.env.SCOUTING_DB.prepare(
                "SELECT team_number, team_name FROM manual_teams WHERE event_key = ? ORDER BY CAST(team_number AS INTEGER)",
              )
                .bind(eventKey)
                .all<{ team_number: string; team_name: string }>()
            ).results.map((team) => [team.team_number, team.team_name]),
          )
        : {},
  });
});

app.put("/event-context", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const activeConfig = await c.env.SCOUTING_DB.prepare(
    "SELECT event_key, tba_auth_key, schedule_mode FROM strategy_event_config WHERE id = 1",
  ).first<{ event_key: string; tba_auth_key: string | null; schedule_mode: string }>();
  const eventKey =
    activeConfig?.schedule_mode === "manual"
      ? activeConfig.event_key
      : text(body.eventKey, 30).toLowerCase();
  const tbaAuthKey = text(body.tbaAuthKey, 200);
  const nexusEventKey = text(body.nexusEventKey, 30).toLowerCase() || eventKey;
  const nexusApiKey = text(body.nexusApiKey, 300);
  if ((tbaAuthKey || nexusApiKey) && !c.get("userIsAdmin"))
    return c.json({ error: "Only a team admin can update API keys." }, 403);
  if (activeConfig?.schedule_mode !== "manual" && eventKey && !/^\d{4}[a-z0-9]+$/.test(eventKey))
    return c.json({ error: "Enter a valid TBA event key, such as 2026gadal." }, 400);
  const tbaConfigChanged =
    activeConfig?.schedule_mode !== "manual" &&
    Boolean(eventKey) &&
    (eventKey !== (activeConfig?.event_key || "") || Boolean(tbaAuthKey));
  if (tbaConfigChanged) {
    try {
      await validateTbaConfiguration(
        eventKey,
        tbaAuthKey || activeConfig?.tba_auth_key || c.env.TBA_AUTH_KEY || "",
      );
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Could not validate TBA settings." },
        400,
      );
    }
  }
  const requestedMatch = body.currentMatchNumber;
  const currentMatchNumber =
    requestedMatch === "" || requestedMatch === null || requestedMatch === undefined
      ? null
      : Number(requestedMatch);
  if (
    currentMatchNumber !== null &&
    (!Number.isInteger(currentMatchNumber) || currentMatchNumber < 1)
  )
    return c.json({ error: "Current match must be a positive qualification match number." }, 400);
  const updateConfig = c.env.SCOUTING_DB.prepare(
    `INSERT INTO strategy_event_config (id, event_key, current_match_number, tba_auth_key, nexus_event_key, nexus_api_key, updated_by, updated_at)
     VALUES (1, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?)
     ON CONFLICT(id) DO UPDATE SET event_key = excluded.event_key,
       current_match_number = excluded.current_match_number,
       tba_auth_key = CASE WHEN excluded.tba_auth_key IS NULL THEN strategy_event_config.tba_auth_key ELSE excluded.tba_auth_key END,
       nexus_event_key = excluded.nexus_event_key,
       nexus_api_key = CASE WHEN excluded.nexus_api_key IS NULL THEN strategy_event_config.nexus_api_key ELSE excluded.nexus_api_key END,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(
    eventKey,
    currentMatchNumber,
    tbaAuthKey,
    nexusEventKey,
    nexusApiKey,
    c.get("userId"),
    Date.now(),
  );
  if (tbaConfigChanged) {
    await c.env.SCOUTING_DB.batch([
      updateConfig,
      c.env.SCOUTING_DB.prepare("DELETE FROM tba_match_cache WHERE event_key = ?").bind(eventKey),
      c.env.SCOUTING_DB.prepare("DELETE FROM tba_team_cache WHERE event_key = ?").bind(eventKey),
    ]);
  } else {
    await updateConfig.run();
  }
  return c.json({ ok: true });
});

app.post("/manual-mode", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const eventName = text(body.eventName, 100);
  const endsAt = Number(body.endsAt);
  if (!eventName) return c.json({ error: "Event name is required." }, 400);
  if (!Number.isFinite(endsAt) || endsAt < Date.now() - 86_400_000)
    return c.json({ error: "Enter the competition end date." }, 400);
  const eventKey = `manual-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8)}`;
  const deleteAfter = endsAt + 3 * 86_400_000;
  await c.env.SCOUTING_DB.batch([
    c.env.SCOUTING_DB.prepare(
      "INSERT INTO manual_events (event_key, event_name, ends_at, delete_after, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(eventKey, eventName, endsAt, deleteAfter, c.get("userId"), Date.now()),
    c.env.SCOUTING_DB.prepare(
      `INSERT INTO strategy_event_config (id, event_key, current_match_number, updated_by, updated_at, schedule_mode)
       VALUES (1, ?, NULL, ?, ?, 'manual')
       ON CONFLICT(id) DO UPDATE SET event_key = excluded.event_key, current_match_number = NULL,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at, schedule_mode = 'manual'`,
    ).bind(eventKey, c.get("userId"), Date.now()),
  ]);
  return c.json({ ok: true, eventKey, deleteAfter });
});

app.delete("/manual-mode", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const config = await c.env.SCOUTING_DB.prepare(
    "SELECT event_key FROM strategy_event_config WHERE id = 1 AND schedule_mode = 'manual'",
  ).first<{ event_key: string }>();
  if (config?.event_key) {
    await c.env.SCOUTING_DB.batch([
      c.env.SCOUTING_DB.prepare("DELETE FROM manual_matches WHERE event_key = ?").bind(
        config.event_key,
      ),
      c.env.SCOUTING_DB.prepare("DELETE FROM manual_teams WHERE event_key = ?").bind(
        config.event_key,
      ),
      c.env.SCOUTING_DB.prepare("DELETE FROM manual_events WHERE event_key = ?").bind(
        config.event_key,
      ),
      c.env.SCOUTING_DB.prepare(
        "UPDATE strategy_event_config SET event_key = '', current_match_number = NULL, schedule_mode = 'tba', updated_by = ?, updated_at = ? WHERE id = 1",
      ).bind(c.get("userId"), Date.now()),
    ]);
  }
  return c.json({ ok: true });
});

function validatedSchedule(value: unknown, allowPartial = false) {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const rawMatches = Array.isArray(value)
    ? value
    : Array.isArray(input.matches)
      ? input.matches
      : Array.isArray(input.schedule)
        ? input.schedule
        : [];
  const invalidRows: number[] = [];
  const matches = rawMatches.slice(0, 500).flatMap((item, index) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const asTeamList = (value: unknown) =>
      Array.isArray(value)
        ? value
        : typeof value === "string"
          ? (value.match(/\d{1,6}/g) ?? [])
          : [];
    const red = Array.isArray(row.redTeams)
      ? row.redTeams
      : asTeamList(row.red).length
        ? asTeamList(row.red)
        : asTeamList(row.r).length
          ? asTeamList(row.r)
          : [row.red1 ?? row.red_1, row.red2 ?? row.red_2, row.red3 ?? row.red_3];
    const blue = Array.isArray(row.blueTeams)
      ? row.blueTeams
      : asTeamList(row.blue).length
        ? asTeamList(row.blue)
        : asTeamList(row.b).length
          ? asTeamList(row.b)
          : [row.blue1 ?? row.blue_1, row.blue2 ?? row.blue_2, row.blue3 ?? row.blue_3];
    const arrayRow = Array.isArray(item) ? item : [];
    const explicitTeams = asTeamList(row.teams).length ? asTeamList(row.teams) : asTeamList(row.a);
    const rawTeams = explicitTeams.length
      ? explicitTeams
      : arrayRow.length >= 7
        ? arrayRow.slice(-6)
        : arrayRow.length === 6
          ? arrayRow
          : [...red, ...blue];
    const visualTeams = rawTeams.map((team) => teamNumber(team, !allowPartial));
    const columnOrder = String(row.order ?? row.o ?? "").toLowerCase();
    const teams =
      columnOrder === "blue-red" && visualTeams.length === 6
        ? [...visualTeams.slice(3), ...visualTeams.slice(0, 3)]
        : visualTeams;
    const matchNumber = Number(
      row.matchNumber ?? row.match_number ?? row.match ?? row.number ?? row.n ?? index + 1,
    );
    const rawTime = row.scheduledAt ?? row.scheduled_time ?? row.time ?? row.t;
    const timeText = String(rawTime ?? "");
    const scheduledAt =
      typeof rawTime === "number" && rawTime > 946_684_800_000
        ? rawTime
        : /\b20\d{2}\b/.test(timeText)
          ? Date.parse(timeText)
          : null;
    if (
      !Number.isInteger(matchNumber) ||
      matchNumber < 1 ||
      teams.length !== 6 ||
      teams.some((n) => !n)
    ) {
      if (allowPartial) {
        invalidRows.push(
          Number.isInteger(matchNumber) && matchNumber > 0 ? matchNumber : index + 1,
        );
        if (!Number.isInteger(matchNumber) || matchNumber < 1) return [];
        const partialTeams = Array.from({ length: 6 }, (_, teamIndex) => teams[teamIndex] || "");
        return [
          {
            matchNumber,
            teams: partialTeams,
            scheduledAt: Number.isFinite(scheduledAt) ? scheduledAt : null,
          },
        ];
      }
      throw new Error(`Match ${index + 1} needs a positive number and exactly six valid teams.`);
    }
    return [{ matchNumber, teams, scheduledAt: Number.isFinite(scheduledAt) ? scheduledAt : null }];
  });
  const names = (
    input.teamNames && typeof input.teamNames === "object"
      ? input.teamNames
      : input.teams && !Array.isArray(input.teams) && typeof input.teams === "object"
        ? input.teams
        : {}
  ) as Record<string, unknown>;
  const teams = new Map<string, string>();
  for (const match of matches)
    for (const number of match.teams) if (number) teams.set(number, text(names[number], 120));
  return { matches, teams, invalidRows };
}

app.put("/manual-schedule", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const config = await c.env.SCOUTING_DB.prepare(
    "SELECT event_key FROM strategy_event_config WHERE id = 1 AND schedule_mode = 'manual'",
  ).first<{ event_key: string }>();
  if (!config?.event_key) return c.json({ error: "Switch to all-manual mode first." }, 409);
  let schedule: ReturnType<typeof validatedSchedule>;
  try {
    schedule = validatedSchedule(await c.req.json());
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid schedule." }, 400);
  }
  const cachedTeamRows = await c.env.SCOUTING_DB.prepare(
    "SELECT teams_json FROM tba_team_cache ORDER BY expires_at DESC LIMIT 20",
  ).all<{ teams_json: string }>();
  const knownNames = new Map<string, string>();
  for (const row of cachedTeamRows.results) {
    for (const team of parseJson<TbaTeam[]>(row.teams_json, [])) {
      if (!knownNames.has(String(team.team_number)))
        knownNames.set(String(team.team_number), team.nickname || team.name || "");
    }
  }
  for (const [number, name] of Array.from(schedule.teams.entries())) {
    if (!name) schedule.teams.set(number, knownNames.get(number) || "");
  }
  const statements = [
    c.env.SCOUTING_DB.prepare("DELETE FROM manual_matches WHERE event_key = ?").bind(
      config.event_key,
    ),
    c.env.SCOUTING_DB.prepare("DELETE FROM manual_teams WHERE event_key = ?").bind(
      config.event_key,
    ),
  ];
  for (const [number, name] of Array.from(schedule.teams.entries()))
    statements.push(
      c.env.SCOUTING_DB.prepare(
        "INSERT INTO manual_teams (event_key, team_number, team_name) VALUES (?, ?, ?)",
      ).bind(config.event_key, number, name),
    );
  for (const match of schedule.matches)
    statements.push(
      c.env.SCOUTING_DB.prepare(
        `INSERT INTO manual_matches (event_key, match_key, match_number, scheduled_at, red_1, red_2, red_3, blue_1, blue_2, blue_3)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        config.event_key,
        `${config.event_key}_qm${match.matchNumber}`,
        match.matchNumber,
        match.scheduledAt,
        ...match.teams,
      ),
    );
  await c.env.SCOUTING_DB.batch(statements);
  return c.json({ ok: true, matchCount: schedule.matches.length, teamCount: schedule.teams.size });
});

app.post("/manual-schedule/extract", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const form = await c.req.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  const legacyFile = form.get("file");
  if (!files.length && legacyFile instanceof File) files.push(legacyFile);
  if (!files.length)
    return c.json({ error: "Choose one or more schedule photos or documents." }, 400);
  if (files.length > 4) return c.json({ error: "Upload no more than four pages at once." }, 400);
  if (
    files.some((file) => file.size > 15_000_000) ||
    files.reduce((n, file) => n + file.size, 0) > 40_000_000
  )
    return c.json({ error: "Each file must be under 15 MB and the upload under 40 MB." }, 413);

  const prompt = `Read this FRC match schedule photo or screenshot. Transcribe every visible practice, qualification, or playoff match.
The page may be angled, rotated, wrinkled, dim, or contain tables side by side. Side-by-side blocks continue the schedule. Ignore rankings, page numbers, and sponsor text.
Copy the six team cells in their exact printed LEFT-TO-RIGHT order. Set "o" to "blue-red" when the headers show Blue 1-3 before Red 1-3, otherwise set it to "red-blue". Keep the match-number column separate: match 6 followed by team ${site.team.number} means ${site.team.number}, never 6${site.team.number}. Never guess an unreadable digit.
Inspect each row digit-by-digit. Always include every visible match row and use null only for an individual team cell that truly cannot be read; never omit the entire row.
Return ONLY compact JSON: {"matches":[{"n":1,"t":null,"o":"red-blue","a":[${site.team.number},1771,4910,2974,6829,8736]}]}. No names, markdown, or explanations.`;
  const visionOutput = async (result: unknown) => {
    const modelResult = result as {
      response?: string;
      description?: string;
      result?: string;
      choices?: { message?: { content?: string } }[];
    };
    return result instanceof Response
      ? await result.text()
      : result instanceof ReadableStream
        ? await new Response(result).text()
        : typeof result === "string"
          ? result
          : String(
              modelResult.response ??
                modelResult.description ??
                modelResult.result ??
                modelResult.choices?.[0]?.message?.content ??
                "",
            );
  };
  const runVision = (
    encodedImage: string,
    mimeType: string,
    requestPrompt: string,
    maxTokens = 768,
  ) =>
    withTimeout(
      c.env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: requestPrompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${encodedImage}` } },
            ],
          },
        ],
        max_tokens: maxTokens,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
      } as never),
      30_000,
      "Image scan",
    );
  const combinedMatches = new Map<
    number,
    { matchNumber: number; scheduledAt: number | null; teams: string[] }
  >();
  const combinedTeams = new Map<string, string>();
  const warnings: string[] = [];
  const knownTeamNumbers = new Set<string>([String(site.team.number)]);
  const cachedTeams = await c.env.SCOUTING_DB.prepare(
    "SELECT teams_json FROM tba_team_cache ORDER BY expires_at DESC LIMIT 20",
  ).all<{ teams_json: string }>();
  for (const row of cachedTeams.results)
    for (const team of parseJson<TbaTeam[]>(row.teams_json, []))
      knownTeamNumbers.add(String(team.team_number));
  const isOneOcrEdit = (left: string, right: string) => {
    if (left === right) return true;
    if (left.length === right.length) {
      const differences = Array.from({ length: left.length }, (_, index) => index).filter(
        (index) => left[index] !== right[index],
      );
      return (
        differences.length === 1 ||
        (differences.length === 2 &&
          differences[1] === differences[0] + 1 &&
          left[differences[0]] === right[differences[1]] &&
          left[differences[1]] === right[differences[0]])
      );
    }
    const longer = left.length > right.length ? left : right;
    const shorter = left.length > right.length ? right : left;
    if (longer.length !== shorter.length + 1) return false;
    return Array.from({ length: longer.length }, (_, index) => index).some(
      (index) => longer.slice(0, index) + longer.slice(index + 1) === shorter,
    );
  };
  const normalizeScannedTeam = (number: string) => {
    if (!number) return "";
    if (knownTeamNumbers.has(number)) return number;
    const candidates = new Set<string>();
    for (const known of Array.from(knownTeamNumbers)) {
      if (Number(number) > MAX_FRC_TEAM_NUMBER) {
        if (isOneOcrEdit(number, known)) candidates.add(known);
        continue;
      }
      for (let index = 0; index < number.length - 1; index += 1) {
        const chars = number.split("");
        [chars[index], chars[index + 1]] = [chars[index + 1], chars[index]];
        if (chars.join("") === known) candidates.add(known);
      }
    }
    if (candidates.size === 1) return Array.from(candidates)[0];
    return Number(number) <= MAX_FRC_TEAM_NUMBER ? number : "";
  };
  let cachedPageCount = 0;
  const now = Date.now();
  const usageWindow = Math.floor(now / 3_600_000) * 3_600_000;
  await c.env.SCOUTING_DB.batch([
    c.env.SCOUTING_DB.prepare("DELETE FROM manual_scan_cache WHERE expires_at <= ?").bind(now),
    c.env.SCOUTING_DB.prepare("DELETE FROM manual_scan_usage WHERE window_started_at < ?").bind(
      usageWindow - 86_400_000,
    ),
  ]);

  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const contentHash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const cached = await c.env.SCOUTING_DB.prepare(
        "SELECT result_json FROM manual_scan_cache WHERE content_hash = ? AND expires_at > ?",
      )
        .bind(contentHash, now)
        .first<{ result_json: string }>();
      let schedule: ReturnType<typeof validatedSchedule>;
      if (cached) {
        schedule = validatedSchedule(parseJson(cached.result_json, {}), true);
        cachedPageCount += 1;
        if (schedule.invalidRows.length)
          warnings.push(
            `${file.name}: match${schedule.invalidRows.length === 1 ? "" : "es"} ${schedule.invalidRows.join(", ")} still ${schedule.invalidRows.length === 1 ? "has" : "have"} a blank team cell for review`,
          );
        for (const match of schedule.matches) combinedMatches.set(match.matchNumber, match);
        for (const [number, name] of Array.from(schedule.teams.entries()))
          if (name || !combinedTeams.has(number)) combinedTeams.set(number, name);
        continue;
      }
      const usage = await c.env.SCOUTING_DB.prepare(
        "SELECT page_count FROM manual_scan_usage WHERE user_id = ? AND window_started_at = ?",
      )
        .bind(c.get("userId"), usageWindow)
        .first<{ page_count: number }>();
      if ((usage?.page_count ?? 0) >= 12)
        throw new Error(
          "hourly scan limit reached; try again next hour or enter this page manually",
        );
      await c.env.SCOUTING_DB.prepare(
        `INSERT INTO manual_scan_usage (user_id, window_started_at, page_count) VALUES (?, ?, 1)
         ON CONFLICT(user_id, window_started_at) DO UPDATE SET page_count = page_count + 1`,
      )
        .bind(c.get("userId"), usageWindow)
        .run();
      let result: unknown;
      let encodedImage: string | null = null;
      if (file.type.startsWith("image/")) {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 32_768)
          binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + 32_768)));
        encodedImage = btoa(binary);
        result = await runVision(
          encodedImage,
          file.type,
          prompt,
          file.name.includes("-photo-") ? 768 : 1536,
        );
      } else {
        const converted = await withTimeout(
          c.env.AI.toMarkdown({ name: file.name, blob: file }),
          30_000,
          "Document conversion",
        );
        const markdown = Array.isArray(converted) ? converted[0] : converted;
        if (!markdown || markdown.format === "error")
          throw new Error(markdown?.error || "could not be read");
        result = await withTimeout(
          c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
            prompt: `${prompt}\n\n${markdown.data}`,
          }),
          30_000,
          "Schedule extraction",
        );
      }
      const output = await visionOutput(result);
      const jsonText = firstJsonObject(output);
      if (!jsonText)
        throw new Error("the AI response was incomplete; try closer photos of smaller sections");
      const parsedVisionResult = JSON.parse(jsonText);
      schedule = validatedSchedule(parsedVisionResult, true);
      for (const match of schedule.matches) match.teams = match.teams.map(normalizeScannedTeam);
      for (const match of schedule.matches)
        if (
          match.teams.some((number) => !number) &&
          !schedule.invalidRows.includes(match.matchNumber)
        )
          schedule.invalidRows.push(match.matchNumber);
      if (encodedImage && schedule.invalidRows.length && (usage?.page_count ?? 0) < 11) {
        try {
          await c.env.SCOUTING_DB.prepare(
            "UPDATE manual_scan_usage SET page_count = page_count + 1 WHERE user_id = ? AND window_started_at = ?",
          )
            .bind(c.get("userId"), usageWindow)
            .run();
          const recovery = await runVision(
            encodedImage,
            file.type,
            `Zoom in mentally and read ONLY FRC match row${schedule.invalidRows.length === 1 ? "" : "s"} ${schedule.invalidRows.join(", ")} from this schedule photo. Ignore every other row.
The first pass produced these partial Red-then-Blue cells: ${schedule.matches
              .filter((match) => schedule.invalidRows.includes(match.matchNumber))
              .map(
                (match) =>
                  `${match.matchNumber}=[${match.teams.map((team) => team || "?").join(",")}]`,
              )
              .join("; ")}.
Use the printed grid and column headers to fill the question marks and verify the other digits. Keep the match number separate from team numbers. Return ONLY JSON: {"matches":[{"n":1,"red":[${site.team.number},1771,4910],"blue":[2974,6829,8736]}]}. Return only the requested rows, exactly six teams per row.`,
            384,
          );
          const recoveryOutput = await visionOutput(recovery);
          const recoveryJson = firstJsonObject(recoveryOutput);
          if (recoveryJson) {
            const recovered = validatedSchedule(JSON.parse(recoveryJson), true);
            for (const match of recovered.matches) {
              const existing = schedule.matches.findIndex(
                (candidate) => candidate.matchNumber === match.matchNumber,
              );
              if (existing >= 0) {
                if (
                  match.teams.filter(Boolean).length >
                  schedule.matches[existing].teams.filter(Boolean).length
                )
                  schedule.matches[existing] = match;
              } else schedule.matches.push(match);
            }
            schedule.matches.sort((a, b) => a.matchNumber - b.matchNumber);
            const stillInvalid = new Set(recovered.invalidRows);
            const recoveredNumbers = new Set(
              recovered.matches
                .filter((match) => !stillInvalid.has(match.matchNumber))
                .map((match) => match.matchNumber),
            );
            schedule.invalidRows = schedule.invalidRows.filter(
              (matchNumber) => !recoveredNumbers.has(matchNumber),
            );
            for (const match of schedule.matches)
              for (const number of match.teams)
                if (!schedule.teams.has(number)) schedule.teams.set(number, "");
          }
        } catch {
          // Keep the valid first-pass rows; the review table lets an admin add the missing row.
        }
      }
      for (const match of schedule.matches) match.teams = match.teams.map(normalizeScannedTeam);
      for (const match of schedule.matches)
        if (
          match.teams.some((number) => !number) &&
          !schedule.invalidRows.includes(match.matchNumber)
        )
          schedule.invalidRows.push(match.matchNumber);
      schedule.invalidRows.sort((a, b) => a - b);
      if (schedule.invalidRows.length)
        warnings.push(
          `${file.name}: match${schedule.invalidRows.length === 1 ? "" : "es"} ${schedule.invalidRows.join(", ")} had an unreadable or unrealistic team number; the recognized cells were kept and the missing ${schedule.invalidRows.length === 1 ? "cell is" : "cells are"} blank for review`,
        );
      schedule.teams.clear();
      for (const match of schedule.matches)
        for (const number of match.teams) if (number) schedule.teams.set(number, "");
      const suspiciousMatches = schedule.matches.filter((match) => {
        const recognized = match.teams.filter(Boolean);
        return new Set(recognized).size !== recognized.length;
      });
      if (suspiciousMatches.length) {
        warnings.push(
          `${file.name}: skipped match${suspiciousMatches.length === 1 ? "" : "es"} ${suspiciousMatches.map((match) => match.matchNumber).join(", ")} because the scan repeated a team number`,
        );
        const suspiciousNumbers = new Set(suspiciousMatches.map((match) => match.matchNumber));
        schedule.matches = schedule.matches.filter(
          (match) => !suspiciousNumbers.has(match.matchNumber),
        );
      }
      if (!schedule.matches.length) throw new Error("no complete match rows were recognized");
      await c.env.SCOUTING_DB.prepare(
        "INSERT OR REPLACE INTO manual_scan_cache (content_hash, result_json, expires_at) VALUES (?, ?, ?)",
      )
        .bind(
          contentHash,
          JSON.stringify({
            matches: schedule.matches,
            teams: Object.fromEntries(schedule.teams),
          }),
          now + 86_400_000,
        )
        .run();
      for (const match of schedule.matches) combinedMatches.set(match.matchNumber, match);
      for (const [number, name] of Array.from(schedule.teams.entries()))
        if (name || !combinedTeams.has(number)) combinedTeams.set(number, name);
    } catch (error) {
      warnings.push(
        `${file.name}: ${error instanceof Error ? error.message : "could not be read"}`,
      );
    }
  }
  const matches = Array.from(combinedMatches.values()).sort(
    (a, b) => a.matchNumber - b.matchNumber,
  );
  if (!matches.length)
    return c.json({ error: warnings.join(" ") || "No matches were recognized." }, 422);
  return c.json({
    matches: matches.map((match) => ({
      ...match,
      scheduledAt: match.scheduledAt ? new Date(match.scheduledAt).toISOString() : null,
    })),
    teams: Object.fromEntries(combinedTeams),
    warnings,
    pageCount: files.length,
    cachedPageCount,
  });
});

app.get("/announcements/active", requireAuth, async (c) => {
  const rows = await c.env.SCOUTING_DB.prepare(
    `SELECT id, message, created_by_name, created_at, expires_at
     FROM strategy_announcements
     WHERE expires_at > ?
     ORDER BY created_at DESC
     LIMIT 5`,
  )
    .bind(Date.now())
    .all<Record<string, unknown>>();
  return c.json({ announcements: rows.results });
});

app.put("/presence", requireAuth, async (c) => {
  const body: Record<string, unknown> = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}));
  const allowedPages = new Set([
    "forms",
    "admin",
    "analysis",
    "service",
    "autos",
    "other",
    "tiers",
    "maps",
  ]);
  const requestedPage = text(body.page, 30);
  const currentPage = allowedPages.has(requestedPage) ? requestedPage : "forms";
  await c.env.SCOUTING_DB.prepare(
    `INSERT INTO strategy_presence (user_id, display_name, is_admin, last_seen_at, current_page)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name,
       is_admin = excluded.is_admin, last_seen_at = excluded.last_seen_at,
       current_page = excluded.current_page`,
  )
    .bind(
      c.get("userId"),
      c.get("userDisplayName"),
      (await isStrategyAdmin(c)) ? 1 : 0,
      Date.now(),
      currentPage,
    )
    .run();
  return c.json({ ok: true });
});

app.get("/presence", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const rows = await c.env.SCOUTING_DB.prepare(
    `SELECT user_id, display_name, is_admin, last_seen_at, current_page
     FROM strategy_presence
     WHERE last_seen_at >= ?
     ORDER BY is_admin DESC, display_name`,
  )
    .bind(Date.now() - 75_000)
    .all<Record<string, unknown>>();
  return c.json({ users: rows.results });
});

app.post("/announcements", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const message = text(body.message, 500);
  const durationSeconds = Number(body.durationSeconds);
  if (!message) return c.json({ error: "Enter an announcement." }, 400);
  if (![30, 60, 300, 600].includes(durationSeconds))
    return c.json({ error: "Choose a valid announcement duration." }, 400);
  const now = Date.now();
  const announcementId = id("announcement");
  await c.env.SCOUTING_DB.prepare(
    `INSERT INTO strategy_announcements
       (id, message, created_by, created_by_name, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      announcementId,
      message,
      c.get("userId"),
      c.get("userDisplayName"),
      now,
      now + durationSeconds * 1000,
    )
    .run();
  return c.json({ id: announcementId }, 201);
});

function parseScoutingFields(value: unknown): ScoutingField[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const allowedTypes = new Set([
    "shortText",
    "longText",
    "mcq",
    "slider",
    "fieldMap",
    "multiSelect",
    "counter",
  ]);
  const fields = value.map((candidate) => {
    const field = candidate as Record<string, unknown>;
    return {
      id: text(field.id, 100),
      label: text(field.label, 120),
      caption: text(field.caption, 500),
      type: text(field.type, 20) as ScoutingField["type"],
      required: field.required === true,
      options: stringArray(field.options, 30),
      min: Number.isFinite(Number(field.min)) ? Number(field.min) : 0,
      max: Number.isFinite(Number(field.max)) ? Number(field.max) : 10,
      step:
        field.type === "counter"
          ? 1
          : Number.isFinite(Number(field.step)) && Number(field.step) > 0
            ? Number(field.step)
            : 1,
    };
  });
  if (
    fields.some((field) => !field.id || !field.label || !allowedTypes.has(field.type)) ||
    new Set(fields.map((field) => field.id)).size !== fields.length
  )
    return null;
  return fields;
}

app.get("/engagement-settings", requireAuth, async (c) =>
  c.json(await getEngagementSettings(c.env.SCOUTING_DB)),
);

app.put("/engagement-settings", requireAuth, async (c) => {
  if (!c.get("userIsAdmin") || c.get("sessionType") === "pin")
    return c.json({ error: "Only a team admin can change engagement settings." }, 403);
  const settings = parseEngagementSettings(await c.req.json().catch(() => null));
  if (!settings)
    return c.json(
      { error: "Use boolean activity switches and a points name of 1 to 40 characters." },
      400,
    );
  await c.env.SCOUTING_DB.prepare(
    `INSERT INTO scouting_engagement_settings
      (team_key, enabled, predictions_enabled, combinations_enabled, leaderboard_enabled, points_label, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(team_key) DO UPDATE SET
       enabled = excluded.enabled, predictions_enabled = excluded.predictions_enabled,
       combinations_enabled = excluded.combinations_enabled, leaderboard_enabled = excluded.leaderboard_enabled,
       points_label = excluded.points_label, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(
      teamKey,
      Number(settings.enabled),
      Number(settings.predictionsEnabled),
      Number(settings.combinationsEnabled),
      Number(settings.leaderboardEnabled),
      settings.pointsLabel,
      c.get("userId"),
      Date.now(),
    )
    .run();
  return c.json(settings);
});

app.get("/game", requireAuth, async (c) => {
  const settings = await getEngagementSettings(c.env.SCOUTING_DB);
  if (!settings.enabled)
    return c.json({ error: "Scouting engagement is disabled for this team." }, 403);
  const now = Date.now();
  await c.env.SCOUTING_DB.prepare(
    `INSERT INTO boylebucks_accounts (user_id, display_name, balance, earned, wagered, updated_at)
     VALUES (?, ?, 0, 0, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
  )
    .bind(c.get("userId"), c.get("userDisplayName"), now)
    .run();
  const config = await c.env.SCOUTING_DB.prepare(
    "SELECT event_key, current_match_number FROM strategy_event_config WHERE id = 1",
  ).first<{ event_key: string; current_match_number: number | null }>();
  if (c.env.LOCAL_AUTH_BYPASS === "true" && config?.event_key === "local-demo") {
    const reference = `local-demo-credit:${c.get("userId")}`;
    await c.env.SCOUTING_DB.batch([
      c.env.SCOUTING_DB.prepare(
        `UPDATE boylebucks_accounts
            SET balance = balance + 250, updated_at = ?
          WHERE user_id = ?
            AND NOT EXISTS (SELECT 1 FROM boylebucks_ledger WHERE reference_id = ?)`,
      ).bind(now, c.get("userId"), reference),
      c.env.SCOUTING_DB.prepare(
        `INSERT OR IGNORE INTO boylebucks_ledger
          (id, user_id, amount, reason, reference_id, created_at)
         VALUES (?, ?, 250, 'Local prediction test points', ?, ?)`,
      ).bind(id("ledger"), c.get("userId"), reference, now),
    ]);
  }
  let matches: GameMatch[] = [];
  let statsError = "";
  if (settings.predictionsEnabled && config?.event_key) {
    try {
      matches = await gameMatches(c.env, config.event_key);
      await settleGameBets(c.env.SCOUTING_DB, config.event_key, matches);
      await settleGameParlays(c.env.SCOUTING_DB, config.event_key, matches);
    } catch (error) {
      statsError = error instanceof Error ? error.message : "Statbotics is unavailable.";
    }
  }
  const account = await c.env.SCOUTING_DB.prepare(
    "SELECT balance, earned, wagered FROM boylebucks_accounts WHERE user_id = ?",
  )
    .bind(c.get("userId"))
    .first<Record<string, number>>();
  const leaderboard = settings.leaderboardEnabled
    ? await c.env.SCOUTING_DB.prepare(
        `SELECT display_name, balance, earned, wagered
       FROM boylebucks_accounts
      ORDER BY balance DESC, earned DESC, display_name`,
      ).all<Record<string, unknown>>()
    : { results: [] };
  const bets = await c.env.SCOUTING_DB.prepare(
    `SELECT id, match_key, match_label, market, selection, line, odds, stake, status, payout, placed_at
       FROM game_bets WHERE user_id = ? ORDER BY placed_at DESC LIMIT 30`,
  )
    .bind(c.get("userId"))
    .all<Record<string, unknown>>();
  const parlayRows = await c.env.SCOUTING_DB.prepare(
    `SELECT p.id, p.odds, p.stake, p.status, p.payout, p.placed_at,
            l.match_label, l.market, l.selection, l.line, l.odds AS leg_odds, l.status AS leg_status
       FROM game_parlays p
       JOIN game_parlay_legs l ON l.parlay_id = p.id
      WHERE p.user_id = ?
        AND p.id IN (SELECT id FROM game_parlays WHERE user_id = ? ORDER BY placed_at DESC LIMIT 20)
      ORDER BY p.placed_at DESC, l.match_label`,
  )
    .bind(c.get("userId"), c.get("userId"))
    .all<Record<string, unknown>>();
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

app.post("/game/bets", requireAuth, async (c) => {
  const settings = await getEngagementSettings(c.env.SCOUTING_DB);
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
  const config = await c.env.SCOUTING_DB.prepare(
    "SELECT event_key, current_match_number FROM strategy_event_config WHERE id = 1",
  ).first<{ event_key: string; current_match_number: number | null }>();
  if (!config?.event_key) return c.json({ error: "No event is configured." }, 409);
  let matches: GameMatch[];
  try {
    matches = await gameMatches(c.env, config.event_key);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Statbotics is unavailable." },
      503,
    );
  }
  const match = matches.find((candidate) => candidate.key === matchKey);
  if (!match || !gameMatchIsOpen(match, Date.now(), config.current_match_number ?? 0))
    return c.json({ error: "That match is no longer open for predictions." }, 409);
  const account = await c.env.SCOUTING_DB.prepare(
    "SELECT balance FROM boylebucks_accounts WHERE user_id = ?",
  )
    .bind(c.get("userId"))
    .first<{ balance: number }>();
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
    await c.env.SCOUTING_DB.batch([
      c.env.SCOUTING_DB.prepare(
        `INSERT INTO game_bets
          (id, user_id, user_name, event_key, match_key, match_label, market, selection, line, odds, stake, status, payout, placed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?)`,
      ).bind(
        betId,
        c.get("userId"),
        c.get("userDisplayName"),
        config.event_key,
        match.key,
        match.label,
        market,
        selection,
        betLine,
        odds,
        stake,
        placedAt,
      ),
      c.env.SCOUTING_DB.prepare(
        "UPDATE boylebucks_accounts SET balance = balance - ?, wagered = wagered + ?, display_name = ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
      ).bind(stake, stake, c.get("userDisplayName"), placedAt, c.get("userId"), stake),
      c.env.SCOUTING_DB.prepare(
        "INSERT INTO boylebucks_ledger (id, user_id, amount, reason, reference_id, created_at) VALUES (?, ?, ?, 'Prediction submitted', ?, ?)",
      ).bind(id("ledger"), c.get("userId"), -stake, `wager:${betId}`, placedAt),
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

app.post("/game/parlays", requireAuth, async (c) => {
  const settings = await getEngagementSettings(c.env.SCOUTING_DB);
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
  const config = await c.env.SCOUTING_DB.prepare(
    "SELECT event_key, current_match_number FROM strategy_event_config WHERE id = 1",
  ).first<{ event_key: string; current_match_number: number | null }>();
  if (!config?.event_key) return c.json({ error: "No event is configured." }, 409);
  let matches: GameMatch[];
  try {
    matches = await gameMatches(c.env, config.event_key);
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
  const account = await c.env.SCOUTING_DB.prepare(
    "SELECT balance FROM boylebucks_accounts WHERE user_id = ?",
  )
    .bind(c.get("userId"))
    .first<{ balance: number }>();
  if (!account || account.balance < stake)
    return c.json({ error: "You do not have enough points." }, 409);
  const parlayId = id("parlay");
  const odds = combinedAmericanOdds(legs.map((leg) => leg.odds));
  const statements = [
    c.env.SCOUTING_DB.prepare(
      `INSERT INTO game_parlays
        (id, user_id, user_name, event_key, odds, stake, status, payout, placed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 0, ?)`,
    ).bind(parlayId, c.get("userId"), c.get("userDisplayName"), config.event_key, odds, stake, now),
    ...legs.map((leg) =>
      c.env.SCOUTING_DB.prepare(
        `INSERT INTO game_parlay_legs
          (id, parlay_id, match_key, match_label, market, selection, line, odds, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      ).bind(
        id("leg"),
        parlayId,
        leg.match.key,
        leg.match.label,
        leg.market,
        leg.selection,
        leg.line,
        leg.odds,
      ),
    ),
    c.env.SCOUTING_DB.prepare(
      "UPDATE boylebucks_accounts SET balance = balance - ?, wagered = wagered + ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
    ).bind(stake, stake, now, c.get("userId"), stake),
    c.env.SCOUTING_DB.prepare(
      "INSERT INTO boylebucks_ledger (id, user_id, amount, reason, reference_id, created_at) VALUES (?, ?, ?, 'Combined pick submitted', ?, ?)",
    ).bind(id("ledger"), c.get("userId"), -stake, `wager:${parlayId}`, now),
  ];
  try {
    await c.env.SCOUTING_DB.batch(statements);
  } catch (error) {
    if (String(error).includes("insufficient BoyleBucks"))
      return c.json({ error: "You do not have enough points." }, 409);
    throw error;
  }
  return c.json({ ok: true, parlayId, odds }, 201);
});

app.get("/scouting-forms", requireAuth, async (c) => {
  const query =
    "SELECT * FROM scouting_forms WHERE form_kind IN ('scouting', 'pit') ORDER BY form_kind DESC";
  const rows = await c.env.SCOUTING_DB.prepare(query).all<Record<string, unknown>>();
  return c.json({
    forms: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      fields: parseJson<ScoutingField[]>(row.fields_json, []),
      isActive: Boolean(row.is_active),
      kind: row.form_kind,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
});

app.post("/scouting-forms", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const name = text(body.name, 120);
  const fields = parseScoutingFields(body.fields);
  if (!name || !fields?.length)
    return c.json({ error: "A name and at least one valid field are required." }, 400);
  const formId = id("form");
  const now = Date.now();
  await c.env.SCOUTING_DB.prepare(
    "INSERT INTO scouting_forms (id, name, description, fields_json, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      formId,
      name,
      text(body.description, 1000),
      JSON.stringify(fields),
      1,
      c.get("userId"),
      now,
      now,
    )
    .run();
  return c.json({ id: formId }, 201);
});

app.put("/scouting-forms/:id", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const name = text(body.name, 120);
  const fields = parseScoutingFields(body.fields);
  if (!name || !fields?.length)
    return c.json({ error: "A name and at least one valid field are required." }, 400);
  await c.env.SCOUTING_DB.prepare(
    "UPDATE scouting_forms SET name = ?, description = ?, fields_json = ?, is_active = ?, updated_at = ? WHERE id = ?",
  )
    .bind(
      name,
      text(body.description, 1000),
      JSON.stringify(fields),
      1,
      Date.now(),
      c.req.param("id"),
    )
    .run();
  return c.json({ ok: true });
});

app.delete("/scouting-forms/:id", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  await c.env.SCOUTING_DB.prepare("UPDATE scouting_forms SET is_active = 0 WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

app.post("/scouting-forms/:id/submissions", requireAuth, async (c) => {
  const formDefinition = await c.env.SCOUTING_DB.prepare(
    "SELECT fields_json, form_kind FROM scouting_forms WHERE id = ? AND is_active = 1",
  )
    .bind(c.req.param("id"))
    .first<{ fields_json: string; form_kind: string }>();
  if (!formDefinition) return c.json({ error: "Scouting form not found or inactive." }, 404);
  const form = await c.req.formData();
  let teamName = teamNumber(form.get("teamName"));
  const answers = parseJson<Record<string, unknown>>(form.get("answers"), {});
  const fields = parseJson<ScoutingField[]>(formDefinition.fields_json, []);
  const eventLink = await resolveEventLink(c);
  if (formDefinition.form_kind === "scouting") {
    if (!fields.length) return c.json({ error: "This scouting form has no fields." }, 409);
    if (!eventLink.eventKey || !eventLink.matchNumber)
      return c.json({ error: "No current match is configured." }, 409);
    const existing = await c.env.SCOUTING_DB.prepare(
      `SELECT s.id
       FROM scouting_form_submissions s
       JOIN scouting_forms f ON f.id = s.form_id
       WHERE f.form_kind = 'scouting' AND s.submitted_by = ?
         AND s.event_key = ? AND s.match_number = ?
       LIMIT 1`,
    )
      .bind(c.get("userId"), eventLink.eventKey, eventLink.matchNumber)
      .first();
    if (existing)
      return c.json({ error: "You already submitted a scouting form for this match." }, 409);
    const assignment = await c.env.SCOUTING_DB.prepare(
      "SELECT team_number FROM scouting_match_assignments WHERE event_key = ? AND match_number = ? AND user_id = ?",
    )
      .bind(eventLink.eventKey, eventLink.matchNumber, c.get("userId"))
      .first<{ team_number: string }>();
    if (!assignment)
      return c.json({ error: "No team is assigned. Refresh the form and try again." }, 409);
    teamName = assignment.team_number;
  }
  if (!teamName) return c.json({ error: "A valid team number is required." }, 400);
  const cleanAnswers: Record<string, string | number | boolean | string[]> = {};
  for (const field of fields) {
    const value = answers[field.id];
    if (
      formDefinition.form_kind === "scouting" &&
      field.type !== "fieldMap" &&
      !validScoutingEntry(field, value)
    ) {
      return c.json(
        {
          error: `${field.label} must have a value other than 0 before this form can be submitted.`,
        },
        400,
      );
    }
    if (
      field.required &&
      field.type !== "fieldMap" &&
      (value === undefined || value === null || value === "" || value === false)
    ) {
      return c.json({ error: `${field.label} is required.` }, 400);
    }
    if (field.required && field.type === "multiSelect" && stringArray(value, 30).length === 0)
      return c.json({ error: `${field.label} is required.` }, 400);
    if (field.type === "multiSelect") cleanAnswers[field.id] = stringArray(value, 30);
    else if (
      (field.type === "slider" || field.type === "counter") &&
      value !== "" &&
      value !== undefined
    )
      cleanAnswers[field.id] = Number(value);
    else if (field.type !== "fieldMap") cleanAnswers[field.id] = text(value, 3000);
  }
  const submissionId = id("submission");
  const drawing = form.get("drawing");
  let drawingKey: string | null = null;
  let drawingType: string | null = null;
  const drawingFields: Record<string, { key: string; contentType: string }> = {};
  if (drawing instanceof File && drawing.size > 0) {
    if (!drawing.type.startsWith("image/") || drawing.size > 12 * 1024 * 1024)
      return c.json({ error: "The field drawing must be an image under 12 MB." }, 400);
    drawingKey = `scouting-submissions/${submissionId}.png`;
    drawingType = drawing.type;
    await c.env.FIELD_MAPS.put(drawingKey, await drawing.arrayBuffer(), {
      httpMetadata: { contentType: drawing.type },
    });
  }
  for (const field of fields.filter((candidate) => candidate.type === "fieldMap")) {
    const fieldDrawing = form.get(`drawing:${field.id}`);
    if (!(fieldDrawing instanceof File) || fieldDrawing.size === 0) {
      if (field.required || formDefinition.form_kind === "scouting")
        return c.json({ error: `${field.label} is required.` }, 400);
      continue;
    }
    if (!fieldDrawing.type.startsWith("image/") || fieldDrawing.size > 12 * 1024 * 1024)
      return c.json({ error: "Field drawings must be images under 12 MB." }, 400);
    const key = `scouting-submissions/${submissionId}/${field.id}.png`;
    await c.env.FIELD_MAPS.put(key, await fieldDrawing.arrayBuffer(), {
      httpMetadata: { contentType: fieldDrawing.type },
    });
    drawingFields[field.id] = { key, contentType: fieldDrawing.type };
  }
  const submittedAt = Date.now();
  const submissionStatement = c.env.SCOUTING_DB.prepare(
    "INSERT INTO scouting_form_submissions (id, form_id, fields_json, answers_json, drawing_r2_key, drawing_content_type, submitted_by, submitted_by_name, created_at, team_name, drawing_fields_json, event_key, match_key, match_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    submissionId,
    c.req.param("id"),
    formDefinition.fields_json,
    JSON.stringify(cleanAnswers),
    drawingKey,
    drawingType,
    c.get("userId"),
    c.get("userDisplayName"),
    submittedAt,
    teamName,
    JSON.stringify(drawingFields),
    eventLink.eventKey,
    eventLink.matchKey,
    eventLink.matchNumber,
  );
  let boyleBucksAwarded = 0;
  try {
    if (
      formDefinition.form_kind === "scouting" &&
      (await getEngagementSettings(c.env.SCOUTING_DB)).enabled
    ) {
      const rewardReference = `submission:${submissionId}`;
      await c.env.SCOUTING_DB.batch([
        submissionStatement,
        c.env.SCOUTING_DB.prepare(
          `INSERT INTO boylebucks_accounts (user_id, display_name, balance, earned, wagered, updated_at)
           VALUES (?, ?, 0, 0, 0, ?)
           ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name`,
        ).bind(c.get("userId"), c.get("userDisplayName"), submittedAt),
        c.env.SCOUTING_DB.prepare(
          `UPDATE boylebucks_accounts
              SET balance = balance + 10, earned = earned + 10, updated_at = ?
            WHERE user_id = ?
              AND NOT EXISTS (SELECT 1 FROM boylebucks_ledger WHERE reference_id = ?)`,
        ).bind(submittedAt, c.get("userId"), rewardReference),
        c.env.SCOUTING_DB.prepare(
          `INSERT OR IGNORE INTO boylebucks_ledger
            (id, user_id, amount, reason, reference_id, created_at)
           VALUES (?, ?, 10, 'Valid scouting form', ?, ?)`,
        ).bind(id("ledger"), c.get("userId"), rewardReference, submittedAt),
      ]);
      boyleBucksAwarded = 10;
    } else {
      await submissionStatement.run();
    }
  } catch (error) {
    const uploadedKeys = [
      drawingKey,
      ...Object.values(drawingFields).map((item) => item.key),
    ].filter((key): key is string => Boolean(key));
    if (uploadedKeys.length) await c.env.FIELD_MAPS.delete(uploadedKeys);
    if (String(error).includes("one scouting submission per match"))
      return c.json({ error: "You already submitted a scouting form for this match." }, 409);
    throw error;
  }
  return c.json({ id: submissionId, boyleBucksAwarded }, 201);
});

app.get("/scouting-forms/:id/submissions", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const rows = await c.env.SCOUTING_DB.prepare(
    "SELECT * FROM scouting_form_submissions WHERE form_id = ? ORDER BY created_at DESC",
  )
    .bind(c.req.param("id"))
    .all<Record<string, unknown>>();
  return c.json({
    submissions: rows.results.map((row) => ({
      id: row.id,
      answers: parseJson<Record<string, unknown>>(row.answers_json, {}),
      drawingUrl: row.drawing_r2_key ? `/scouting-submissions/${row.id}/drawing` : null,
      submittedByName: row.submitted_by_name,
      createdAt: row.created_at,
      teamName: row.team_name,
      drawings: Object.fromEntries(
        Object.keys(parseJson<Record<string, unknown>>(row.drawing_fields_json, {})).map(
          (fieldId) => [fieldId, `/scouting-submissions/${row.id}/drawings/${fieldId}`],
        ),
      ),
    })),
  });
});

app.get("/scouting-submissions/:id/drawing", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const row = await c.env.SCOUTING_DB.prepare(
    "SELECT drawing_r2_key, drawing_content_type FROM scouting_form_submissions WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ drawing_r2_key: string | null; drawing_content_type: string | null }>();
  if (!row?.drawing_r2_key) return c.json({ error: "Drawing not found." }, 404);
  const object = await c.env.FIELD_MAPS.get(row.drawing_r2_key);
  if (!object) return c.json({ error: "Drawing not found." }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": row.drawing_content_type ?? "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
});

app.get("/scouting-submissions/:id/drawings/:fieldId", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const row = await c.env.SCOUTING_DB.prepare(
    "SELECT drawing_fields_json FROM scouting_form_submissions WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ drawing_fields_json: string }>();
  const drawing = parseJson<Record<string, { key: string; contentType: string }>>(
    row?.drawing_fields_json,
    {},
  )[c.req.param("fieldId")];
  if (!drawing) return c.json({ error: "Drawing not found." }, 404);
  const object = await c.env.FIELD_MAPS.get(drawing.key);
  if (!object) return c.json({ error: "Drawing not found." }, 404);
  return new Response(object.body, {
    headers: { "Content-Type": drawing.contentType, "Cache-Control": "private, max-age=300" },
  });
});

app.get("/tier-lists", requireAuth, async (c) => {
  const rows = await c.env.SCOUTING_DB.prepare(
    "SELECT * FROM tier_lists ORDER BY updated_at DESC",
  ).all<Record<string, unknown>>();
  return c.json({
    tierLists: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      tiers: parseJson<Tier[]>(row.tiers_json, []),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
});

app.post("/tier-lists", requireAuth, async (c) => {
  const body = await c.req.json<TierListInput>();
  const name = text(body.name, 120);
  if (!name) return c.json({ error: "Name is required." }, 400);
  const tiers = Array.isArray(body.tiers) ? body.tiers : [];
  const recordId = id("tier");
  const now = Date.now();
  await c.env.SCOUTING_DB.prepare(
    "INSERT INTO tier_lists (id, name, description, tiers_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      recordId,
      name,
      text(body.description, 500),
      JSON.stringify(tiers),
      c.get("userId"),
      now,
      now,
    )
    .run();
  return c.json({ id: recordId }, 201);
});

app.put("/tier-lists/:id", requireAuth, async (c) => {
  const body = await c.req.json<TierListInput>();
  const name = text(body.name, 120);
  if (!name || !Array.isArray(body.tiers)) {
    return c.json({ error: "Name and tiers are required." }, 400);
  }
  await c.env.SCOUTING_DB.prepare(
    "UPDATE tier_lists SET name = ?, description = ?, tiers_json = ?, updated_at = ? WHERE id = ?",
  )
    .bind(
      name,
      text(body.description, 500),
      JSON.stringify(body.tiers),
      Date.now(),
      c.req.param("id"),
    )
    .run();
  return c.json({ ok: true });
});

app.delete("/tier-lists/:id", requireAuth, async (c) => {
  await c.env.SCOUTING_DB.prepare("DELETE FROM tier_lists WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

app.get("/field-maps", requireAuth, async (c) => {
  const rows = await c.env.SCOUTING_DB.prepare(
    "SELECT * FROM field_maps ORDER BY updated_at DESC",
  ).all<Record<string, unknown>>();
  return c.json({
    fieldMaps: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      eventName: row.event_name,
      notes: row.notes,
      imageUrl: `/field-maps/${row.id}/image`,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
});

async function canShareFieldMaps(c: Context<AppEnv>) {
  if (c.get("userIsAdmin")) return true;
  const permission = await c.env.SCOUTING_DB.prepare(
    "SELECT email FROM field_map_publishers WHERE email = ?",
  )
    .bind(c.get("userEmail").toLowerCase())
    .first();
  return Boolean(permission);
}

app.get("/field-map-permissions", requireAuth, async (c) =>
  c.json({ canShare: await canShareFieldMaps(c), isAdmin: c.get("userIsAdmin") }),
);

app.get("/field-map-publishers", requireAuth, async (c) => {
  if (!c.get("userIsAdmin")) return c.json({ error: "Admin access required." }, 403);
  const rows = await c.env.SCOUTING_DB.prepare(
    "SELECT email, created_at FROM field_map_publishers ORDER BY email",
  ).all<{ email: string; created_at: number }>();
  return c.json({ publishers: rows.results });
});

async function getG3IdUsers(c: Context<AppEnv>) {
  if (c.env.LOCAL_AUTH_BYPASS === "true") {
    return [
      {
        id: c.get("userId"),
        email: c.get("userEmail"),
        displayName: c.get("userDisplayName"),
        status: "active" as const,
      },
    ];
  }
  const response = await c.env.G3ID.fetch(
    new Request("http://g3id/api/users", {
      headers: { cookie: c.req.header("Cookie") ?? "" },
    }),
  );
  if (!response.ok) return null;
  return (await response.json()) as G3IdUser[];
}

app.get("/strategy-admins", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const admins = await c.env.SCOUTING_DB.prepare(
    "SELECT user_id, email, display_name, created_at FROM strategy_admins ORDER BY display_name",
  ).all<Record<string, unknown>>();
  const users = c.get("userIsAdmin") ? await getG3IdUsers(c) : null;
  return c.json({ admins: admins.results, users: users ?? [], canManage: c.get("userIsAdmin") });
});

app.post("/strategy-admins", requireAuth, async (c) => {
  if (!c.get("userIsAdmin"))
    return c.json({ error: "Only a team admin can assign Strategy leads." }, 403);
  const body = await c.req.json<{ userId?: unknown }>();
  const userId = text(body.userId, 200);
  const users = await getG3IdUsers(c);
  const user = users?.find((candidate) => candidate.id === userId && candidate.status === "active");
  if (!user) return c.json({ error: "Select an active account." }, 400);
  await c.env.SCOUTING_DB.prepare(
    "INSERT OR REPLACE INTO strategy_admins (user_id, email, display_name, granted_by, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(user.id, user.email.toLowerCase(), user.displayName, c.get("userId"), Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

app.delete("/strategy-admins/:userId", requireAuth, async (c) => {
  if (!c.get("userIsAdmin"))
    return c.json({ error: "Only a team admin can remove Strategy leads." }, 403);
  await c.env.SCOUTING_DB.prepare("DELETE FROM strategy_admins WHERE user_id = ?")
    .bind(c.req.param("userId"))
    .run();
  return c.json({ ok: true });
});

app.get("/analysis", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const team = teamNumber(c.req.query("team"));
  const teamB = teamNumber(c.req.query("teamB"));
  const includeArchived = c.req.query("archived") === "true";
  const where = team ? (teamB ? "s.team_name IN (?, ?)" : "s.team_name = ?") : "1 = 1";
  const bindings = team ? (teamB ? [team, teamB] : [team]) : [];
  const commentWhere = team ? (teamB ? "team_name IN (?, ?)" : "team_name = ?") : "1 = 1";
  const [rows, teamComments, eventConfig] = await Promise.all([
    c.env.SCOUTING_DB.prepare(
      `SELECT s.*, f.name AS form_name, f.form_kind,
         COALESCE(s.fields_json, f.fields_json) AS fields_json
       FROM scouting_form_submissions s
       JOIN scouting_forms f ON f.id = s.form_id
       WHERE ${where} ${includeArchived ? "" : "AND s.archived_at IS NULL"}
       ORDER BY CASE WHEN s.starred_fields_json = '[]' THEN 1 ELSE 0 END, s.created_at DESC`,
    )
      .bind(...bindings)
      .all<Record<string, unknown>>(),
    c.env.SCOUTING_DB.prepare(
      `SELECT * FROM team_comments WHERE ${commentWhere} ORDER BY created_at DESC`,
    )
      .bind(...bindings)
      .all<Record<string, unknown>>(),
    c.env.SCOUTING_DB.prepare("SELECT event_key FROM strategy_event_config WHERE id = 1").first<{
      event_key: string;
    }>(),
  ]);
  let teamMatches: Record<string, unknown>[] = [];
  if (team && eventConfig?.event_key) {
    try {
      const matches = (await getEventMatches(c, eventConfig.event_key)).sort(
        (a, b) => matchOrder(a) - matchOrder(b),
      );
      const teamKey = `frc${team}`;
      teamMatches = matches
        .filter((match) =>
          [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys].includes(teamKey),
        )
        .map((match) => {
          const alliance = match.alliances.red.team_keys.includes(teamKey) ? "red" : "blue";
          const partner = match.alliances[alliance].team_keys.includes(ourTeam(c));
          const opponent = match.alliances[alliance === "red" ? "blue" : "red"].team_keys.includes(
            ourTeam(c),
          );
          return {
            ...publicMatch(match),
            alliance,
            redTeams: match.alliances.red.team_keys.map((key) => key.replace(/^frc/, "")),
            blueTeams: match.alliances.blue.team_keys.map((key) => key.replace(/^frc/, "")),
            redScore: match.alliances.red.score,
            blueScore: match.alliances.blue.score,
            relationToTeam: partner ? "with" : opponent ? "against" : "none",
            played: match.alliances.red.score >= 0 && match.alliances.blue.score >= 0,
          };
        });
    } catch {
      // Scouting data remains available when TBA is unavailable.
    }
  }
  return c.json({
    reports: rows.results.map((row) => ({
      id: row.id,
      teamName: row.team_name,
      formName: row.form_name,
      formKind: row.form_kind,
      fields: parseJson<ScoutingField[]>(row.fields_json, []),
      answers: parseJson<Record<string, unknown>>(row.answers_json, {}),
      drawings: Object.fromEntries(
        Object.keys(parseJson<Record<string, unknown>>(row.drawing_fields_json, {})).map(
          (fieldId) => [fieldId, `/scouting-submissions/${row.id}/drawings/${fieldId}`],
        ),
      ),
      submittedByName: row.submitted_by_name,
      createdAt: row.created_at,
      eventKey: row.event_key,
      matchKey: row.match_key,
      matchNumber: row.match_number,
      starredFieldIds: parseJson<string[]>(row.starred_fields_json, []),
      archivedAt: row.archived_at,
      archiveReason: row.archive_reason,
    })),
    teamComments: teamComments.results,
    teamMatches,
  });
});

app.put("/analysis/reports/:id/stars", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const body = await c.req.json<{ fieldId?: unknown; starred?: unknown }>();
  const fieldId = text(body.fieldId, 100);
  if (!fieldId) return c.json({ error: "Choose a report or answer to star." }, 400);
  const report = await c.env.SCOUTING_DB.prepare(
    `SELECT s.starred_fields_json, f.fields_json
     FROM scouting_form_submissions s
     JOIN scouting_forms f ON f.id = s.form_id
     WHERE s.id = ?`,
  )
    .bind(c.req.param("id"))
    .first<{ starred_fields_json: string; fields_json: string }>();
  if (!report) return c.json({ error: "Report not found." }, 404);
  const validFieldIds = new Set([
    "__report",
    ...parseJson<ScoutingField[]>(report.fields_json, []).map((field) => field.id),
  ]);
  if (!validFieldIds.has(fieldId)) return c.json({ error: "That answer no longer exists." }, 400);
  const starred = new Set(parseJson<string[]>(report.starred_fields_json, []));
  if (body.starred === true) starred.add(fieldId);
  else starred.delete(fieldId);
  await c.env.SCOUTING_DB.prepare(
    "UPDATE scouting_form_submissions SET starred_fields_json = ? WHERE id = ?",
  )
    .bind(JSON.stringify(Array.from(starred)), c.req.param("id"))
    .run();
  return c.json({ starredFieldIds: Array.from(starred) });
});

app.delete("/analysis/reports/:id", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const body: { reason?: unknown } = await c.req.json<{ reason?: unknown }>().catch(() => ({}));
  const result = await c.env.SCOUTING_DB.prepare(
    "UPDATE scouting_form_submissions SET archived_at = ?, archived_by = ?, archive_reason = ? WHERE id = ? AND archived_at IS NULL",
  )
    .bind(Date.now(), c.get("userId"), text(body.reason, 500), c.req.param("id"))
    .run();
  if (!result.meta.changes) return c.json({ error: "Active report not found." }, 404);
  return c.json({ ok: true });
});

app.put("/analysis/reports/:id/restore", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const result = await c.env.SCOUTING_DB.prepare(
    "UPDATE scouting_form_submissions SET archived_at = NULL, archived_by = NULL, archive_reason = NULL WHERE id = ? AND archived_at IS NOT NULL",
  )
    .bind(c.req.param("id"))
    .run();
  if (!result.meta.changes) return c.json({ error: "Archived report not found." }, 404);
  return c.json({ ok: true });
});

app.delete("/analysis/reports/:id/permanent", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const report = await c.env.SCOUTING_DB.prepare(
    "SELECT drawing_r2_key, drawing_fields_json FROM scouting_form_submissions WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ drawing_r2_key: string | null; drawing_fields_json: string }>();
  if (!report) return c.json({ error: "Report not found." }, 404);
  const fieldDrawings = Object.values(
    parseJson<Record<string, { key: string }>>(report.drawing_fields_json, {}),
  );
  await Promise.all([
    ...fieldDrawings.map((drawing) => c.env.FIELD_MAPS.delete(drawing.key)),
    ...(report.drawing_r2_key ? [c.env.FIELD_MAPS.delete(report.drawing_r2_key)] : []),
  ]);
  await c.env.SCOUTING_DB.prepare("DELETE FROM scouting_form_submissions WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

app.get("/field-map-publisher-options", requireAuth, async (c) => {
  if (!c.get("userIsAdmin")) return c.json({ error: "Admin access required." }, 403);
  const users = await getG3IdUsers(c);
  if (!users) return c.json({ error: "Could not load the team's accounts." }, 502);
  return c.json({
    users: users
      .filter((user) => user.status === "active")
      .map(({ id, email, displayName }) => ({ id, email, displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  });
});

app.post("/field-map-publishers", requireAuth, async (c) => {
  if (!c.get("userIsAdmin")) return c.json({ error: "Admin access required." }, 403);
  const body = await c.req.json<{ userId?: unknown }>();
  const userId = text(body.userId, 200);
  if (!userId) return c.json({ error: "Select an account." }, 400);
  const users = await getG3IdUsers(c);
  if (!users) return c.json({ error: "Could not check that account." }, 502);
  const user = users.find((candidate) => candidate.id === userId && candidate.status === "active");
  if (!user) return c.json({ error: "Select an active account." }, 400);
  const email = user.email.toLowerCase();
  await c.env.SCOUTING_DB.prepare(
    "INSERT OR IGNORE INTO field_map_publishers (email, granted_by, created_at) VALUES (?, ?, ?)",
  )
    .bind(email, c.get("userId"), Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

app.delete("/field-map-publishers/:email", requireAuth, async (c) => {
  if (!c.get("userIsAdmin")) return c.json({ error: "Admin access required." }, 403);
  await c.env.SCOUTING_DB.prepare("DELETE FROM field_map_publishers WHERE email = ?")
    .bind(decodeURIComponent(c.req.param("email")).toLowerCase())
    .run();
  return c.json({ ok: true });
});

app.post("/field-maps", requireAuth, async (c) => {
  if (!(await canShareFieldMaps(c))) {
    return c.json({ error: "You do not have permission to share field maps." }, 403);
  }
  const form = await c.req.formData();
  const image = form.get("image");
  const name = text(form.get("name"), 120);
  if (!(image instanceof File) || !image.type.startsWith("image/") || !name) {
    return c.json({ error: "A name and image are required." }, 400);
  }
  if (image.size > 12 * 1024 * 1024) {
    return c.json({ error: "Images must be smaller than 12 MB." }, 413);
  }

  const recordId = id("map");
  const extension = image.type === "image/jpeg" ? "jpg" : "png";
  const key = `field-maps/${recordId}.${extension}`;
  await c.env.FIELD_MAPS.put(key, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type },
  });
  const now = Date.now();
  await c.env.SCOUTING_DB.prepare(
    "INSERT INTO field_maps (id, name, event_name, notes, r2_key, content_type, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      recordId,
      name,
      text(form.get("eventName"), 120),
      text(form.get("notes"), 2000),
      key,
      image.type,
      c.get("userId"),
      now,
      now,
    )
    .run();
  return c.json({ id: recordId }, 201);
});

app.get("/field-maps/:id/image", requireAuth, async (c) => {
  const map = await c.env.SCOUTING_DB.prepare(
    "SELECT r2_key, content_type FROM field_maps WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ r2_key: string; content_type: string }>();
  if (!map) return c.json({ error: "Map not found." }, 404);
  const object = await c.env.FIELD_MAPS.get(map.r2_key);
  if (!object) return c.json({ error: "Image not found." }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": map.content_type,
      "Cache-Control": "private, max-age=300",
    },
  });
});

app.delete("/field-maps/:id", requireAuth, async (c) => {
  const map = await c.env.SCOUTING_DB.prepare(
    "SELECT r2_key, created_by FROM field_maps WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ r2_key: string; created_by: string }>();
  if (!map) return c.json({ error: "Map not found." }, 404);
  if (!c.get("userIsAdmin") && map.created_by !== c.get("userId")) {
    return c.json({ error: "Only the publisher or an admin can delete this map." }, 403);
  }
  await Promise.all([
    c.env.FIELD_MAPS.delete(map.r2_key),
    c.env.SCOUTING_DB.prepare("DELETE FROM field_maps WHERE id = ?").bind(c.req.param("id")).run(),
  ]);
  return c.json({ ok: true });
});

app.get("/autos", requireAuth, async (c) => {
  const rows = await c.env.SCOUTING_DB.prepare(
    "SELECT * FROM auto_routines ORDER BY updated_at DESC",
  ).all<Record<string, unknown>>();
  return c.json({
    autos: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      team: row.robot_name,
      description: row.summary,
      steps: parseJson<string[]>(row.steps_json, []),
      imageUrl: row.image_r2_key ? `/autos/${row.id}/image` : null,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
});

app.post("/autos", requireAuth, async (c) => {
  const form = await c.req.formData();
  const name = text(form.get("name"), 120);
  if (!name) return c.json({ error: "Name is required." }, 400);
  const rawTeam = text(form.get("team"), 40);
  const autoTeam = rawTeam ? teamNumber(rawTeam) : "";
  if (rawTeam && !autoTeam) return c.json({ error: "Team must be a valid team number." }, 400);

  const image = form.get("image");
  if (image instanceof File && !image.type.startsWith("image/")) {
    return c.json({ error: "The optional upload must be an image." }, 400);
  }
  if (image instanceof File && image.size > 12 * 1024 * 1024) {
    return c.json({ error: "Images must be smaller than 12 MB." }, 413);
  }

  const recordId = id("auto");
  const now = Date.now();
  let imageKey: string | null = null;
  let imageContentType: string | null = null;
  if (image instanceof File && image.size > 0) {
    const extension = image.type === "image/jpeg" ? "jpg" : "png";
    imageKey = `auto-images/${recordId}.${extension}`;
    imageContentType = image.type;
    await c.env.FIELD_MAPS.put(imageKey, await image.arrayBuffer(), {
      httpMetadata: { contentType: image.type },
    });
  }

  const steps = parseJson<unknown>(form.get("steps"), []);
  await c.env.SCOUTING_DB.prepare(
    "INSERT INTO auto_routines (id, name, robot_name, start_position, summary, steps_json, tags_json, image_r2_key, image_content_type, created_by, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, '[]', ?, ?, ?, ?, ?)",
  )
    .bind(
      recordId,
      name,
      autoTeam,
      text(form.get("description"), 2000),
      JSON.stringify(stringArray(steps)),
      imageKey,
      imageContentType,
      c.get("userId"),
      now,
      now,
    )
    .run();
  return c.json({ id: recordId }, 201);
});

app.get("/autos/:id/image", requireAuth, async (c) => {
  const auto = await c.env.SCOUTING_DB.prepare(
    "SELECT image_r2_key, image_content_type FROM auto_routines WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ image_r2_key: string | null; image_content_type: string | null }>();
  if (!auto?.image_r2_key) return c.json({ error: "Image not found." }, 404);
  const object = await c.env.FIELD_MAPS.get(auto.image_r2_key);
  if (!object) return c.json({ error: "Image not found." }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": auto.image_content_type ?? "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
});

app.delete("/autos/:id", requireAuth, async (c) => {
  const auto = await c.env.SCOUTING_DB.prepare(
    "SELECT image_r2_key FROM auto_routines WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ image_r2_key: string | null }>();
  if (auto?.image_r2_key) await c.env.FIELD_MAPS.delete(auto.image_r2_key);
  await c.env.SCOUTING_DB.prepare("DELETE FROM auto_routines WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

// Robot Library was retired. Keep its old tables untouched so existing data is not
// destructively deleted, but do not expose the legacy API surface.
app.all("/robots", (c) => c.json({ error: "Not found." }, 404));
app.all("/robots/*", (c) => c.json({ error: "Not found." }, 404));

app.get("/robots", requireAuth, async (c) => {
  const [teams, images] = await Promise.all([
    c.env.SCOUTING_DB.prepare("SELECT * FROM robot_teams ORDER BY updated_at DESC").all<
      Record<string, unknown>
    >(),
    c.env.SCOUTING_DB.prepare("SELECT * FROM robot_images ORDER BY created_at DESC").all<
      Record<string, unknown>
    >(),
  ]);
  return c.json({
    robots: teams.results.map((team) => ({
      id: team.id,
      teamName: team.team_name,
      summary: team.summary,
      updatedAt: team.updated_at,
      images: images.results
        .filter((image) => image.team_id === team.id)
        .map((image) => ({
          id: image.id,
          url: `/robots/images/${image.id}`,
          createdAt: image.created_at,
        })),
    })),
  });
});

app.post("/robots", requireAuth, async (c) => {
  const form = await c.req.formData();
  const teamName = teamNumber(form.get("teamName"));
  if (!teamName) return c.json({ error: "A valid team number is required." }, 400);
  const teamId = id("robot");
  const now = Date.now();
  await c.env.SCOUTING_DB.prepare(
    "INSERT INTO robot_teams (id, team_name, summary, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(teamId, teamName, text(form.get("summary"), 3000), c.get("userId"), now, now)
    .run();
  const files = form.getAll("images").filter((value): value is File => value instanceof File);
  for (const file of files.slice(0, 20)) {
    if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) continue;
    const imageId = id("robot_image");
    const extension =
      file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
    const key = `robot-images/${teamId}/${imageId}.${extension}`;
    await c.env.FIELD_MAPS.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
    await c.env.SCOUTING_DB.prepare(
      "INSERT INTO robot_images (id, team_id, r2_key, content_type, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(imageId, teamId, key, file.type, c.get("userId"), now)
      .run();
  }
  return c.json({ id: teamId }, 201);
});

app.post("/robots/:id/images", requireAuth, async (c) => {
  const form = await c.req.formData();
  const files = form.getAll("images").filter((value): value is File => value instanceof File);
  const now = Date.now();
  for (const file of files.slice(0, 20)) {
    if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) continue;
    const imageId = id("robot_image");
    const extension =
      file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
    const key = `robot-images/${c.req.param("id")}/${imageId}.${extension}`;
    await c.env.FIELD_MAPS.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
    await c.env.SCOUTING_DB.prepare(
      "INSERT INTO robot_images (id, team_id, r2_key, content_type, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(imageId, c.req.param("id"), key, file.type, c.get("userId"), now)
      .run();
  }
  await c.env.SCOUTING_DB.prepare("UPDATE robot_teams SET updated_at = ? WHERE id = ?")
    .bind(now, c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

app.get("/robots/images/:imageId", requireAuth, async (c) => {
  const image = await c.env.SCOUTING_DB.prepare(
    "SELECT r2_key, content_type FROM robot_images WHERE id = ?",
  )
    .bind(c.req.param("imageId"))
    .first<{ r2_key: string; content_type: string }>();
  if (!image) return c.json({ error: "Image not found." }, 404);
  const object = await c.env.FIELD_MAPS.get(image.r2_key);
  if (!object) return c.json({ error: "Image not found." }, 404);
  return new Response(object.body, {
    headers: { "Content-Type": image.content_type, "Cache-Control": "private, max-age=300" },
  });
});

app.delete("/robots/:id", requireAuth, async (c) => {
  const images = await c.env.SCOUTING_DB.prepare(
    "SELECT r2_key FROM robot_images WHERE team_id = ?",
  )
    .bind(c.req.param("id"))
    .all<{ r2_key: string }>();
  await Promise.all(images.results.map((image) => c.env.FIELD_MAPS.delete(image.r2_key)));
  await c.env.SCOUTING_DB.prepare("DELETE FROM robot_images WHERE team_id = ?")
    .bind(c.req.param("id"))
    .run();
  await c.env.SCOUTING_DB.prepare("DELETE FROM robot_teams WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

app.get("/operations", requireAuth, async (c) => {
  const admin = await isStrategyAdmin(c);
  const allowed = admin || (await isServiceHelper(c));
  if (!allowed) return c.json({ error: "Service crew access required." }, 403);
  const status = c.req.query("status") === "closed" ? "closed" : "active";
  const [rows, helpers, users] = await Promise.all([
    c.env.SCOUTING_DB.prepare(
      status === "closed"
        ? "SELECT * FROM service_tickets WHERE status = 'closed' ORDER BY updated_at DESC LIMIT 500"
        : "SELECT * FROM service_tickets WHERE status IN ('open', 'claimed') ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 200",
    ).all<Record<string, unknown>>(),
    admin
      ? c.env.SCOUTING_DB.prepare("SELECT * FROM service_helpers ORDER BY display_name").all<
          Record<string, unknown>
        >()
      : Promise.resolve({ results: [] }),
    admin ? getG3IdUsers(c) : Promise.resolve([]),
  ]);
  return c.json({
    tickets: rows.results,
    helpers: helpers.results,
    users: users ?? [],
    isAdmin: admin,
  });
});

app.post("/service-tickets", requireAuth, async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const teamName = teamNumber(body.teamName);
  const issueType = text(body.issueType, 20);
  if (!teamName || !["mechanical", "electrical", "programming", "other"].includes(issueType))
    return c.json({ error: "A valid team number and issue type are required." }, 400);
  const ticketId = id("ticket");
  const now = Date.now();
  const eventLink = await resolveEventLink(c);
  await c.env.SCOUTING_DB.prepare(
    "INSERT INTO service_tickets (id, team_name, issue_type, description, status, created_by, created_by_name, created_at, updated_at, event_key, match_key, match_number) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      ticketId,
      teamName,
      issueType,
      text(body.description, 2000),
      c.get("userId"),
      c.get("userDisplayName"),
      now,
      now,
      eventLink.eventKey,
      eventLink.matchKey,
      eventLink.matchNumber,
    )
    .run();
  if (c.env.SLACK_BOT_TOKEN) {
    const helpers = await c.env.SCOUTING_DB.prepare(
      "SELECT slack_user_id FROM service_helpers WHERE slack_user_id IS NOT NULL",
    ).all<{ slack_user_id: string }>();
    await Promise.allSettled(
      helpers.results.map((helper) =>
        sendDM(
          helper.slack_user_id,
          `🔧 New ${issueType} service ticket for team ${teamName}: ${text(body.description, 500) || "No details provided."}\nOpen Event → Pit Scouting to claim it.`,
          { SLACK_BOT_TOKEN: c.env.SLACK_BOT_TOKEN as string },
        ),
      ),
    );
  }
  return c.json({ id: ticketId }, 201);
});

app.post("/team-comments", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c)) && !(await isServiceHelper(c)))
    return c.json({ error: "Service crew access required." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const teamName = teamNumber(body.teamName);
  const comment = text(body.comment, 1000);
  if (!teamName || !comment)
    return c.json({ error: "A valid team number and comment are required." }, 400);
  const sourceTicketId = text(body.sourceTicketId, 200) || null;
  let eventKey: string | null = null;
  if (sourceTicketId) {
    const ticket = await c.env.SCOUTING_DB.prepare(
      "SELECT event_key FROM service_tickets WHERE id = ? AND team_name = ? AND status = 'closed'",
    )
      .bind(sourceTicketId, teamName)
      .first<{ event_key: string | null }>();
    if (!ticket) return c.json({ error: "Choose a closed ticket for this team." }, 400);
    eventKey = ticket.event_key;
  } else {
    eventKey = (await resolveEventLink(c)).eventKey || null;
  }
  const commentId = id("team_comment");
  await c.env.SCOUTING_DB.prepare(
    "INSERT INTO team_comments (id, team_name, comment, event_key, source_ticket_id, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      commentId,
      teamName,
      comment,
      eventKey,
      sourceTicketId,
      c.get("userId"),
      c.get("userDisplayName"),
      Date.now(),
    )
    .run();
  return c.json({ id: commentId }, 201);
});

app.put("/service-tickets/:id", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c)) && !(await isServiceHelper(c)))
    return c.json({ error: "Service crew access required." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const action = text(body.action, 20);
  if (action === "claim")
    await c.env.SCOUTING_DB.prepare(
      "UPDATE service_tickets SET status = 'claimed', claimed_by = ?, claimed_by_name = ?, updated_at = ? WHERE id = ? AND status = 'open'",
    )
      .bind(c.get("userId"), c.get("userDisplayName"), Date.now(), c.req.param("id"))
      .run();
  else if (action === "close") {
    const resolution = text(body.resolution, 2000);
    if (!resolution) return c.json({ error: "A closure comment is required." }, 400);
    await c.env.SCOUTING_DB.prepare(
      "UPDATE service_tickets SET status = 'closed', resolution = ?, updated_at = ? WHERE id = ?",
    )
      .bind(resolution, Date.now(), c.req.param("id"))
      .run();
  } else return c.json({ error: "Unknown action." }, 400);
  return c.json({ ok: true });
});

app.post("/service-helpers", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const users = await getG3IdUsers(c);
  const user = users?.find((item) => item.id === text(body.userId, 200));
  if (!user) return c.json({ error: "Select an active user." }, 400);
  await c.env.SCOUTING_DB.prepare(
    "INSERT OR REPLACE INTO service_helpers (user_id, display_name, email, slack_user_id, skills_json, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      user.id,
      user.displayName,
      user.email,
      user.slackUserId ?? null,
      JSON.stringify(stringArray(body.skills, 10)),
      c.get("userId"),
      Date.now(),
    )
    .run();
  return c.json({ ok: true }, 201);
});

app.delete("/service-helpers/:id", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  await c.env.SCOUTING_DB.prepare("DELETE FROM service_helpers WHERE user_id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

const worker = new Hono<AppEnv>().route("/scouting", app);

export type ScoutingApp = typeof worker;
export default {
  fetch: withApiPrefix(worker.fetch),
  scheduled: (_event: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) => {
    ctx.waitUntil(settleConfiguredGame(env));
  },
};
