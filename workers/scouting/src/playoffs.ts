import { inTeam, requestTeamId, withTeam } from "@g3/auth";
import { asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { teamApiKey } from "./api-keys";
import { type Db, type WriteQuery, batch, dbOf } from "./db";
import {
  manualScanUsage,
  playoffClaims,
  playoffForms,
  playoffMatches,
  playoffParticipants,
  playoffReports,
  playoffSessions,
  strategyEventConfig,
  tbaTeamCache,
} from "./db/schema";
import { requireAuth } from "./middleware/auth";
import {
  type BracketFormat,
  type BracketMatch,
  FORMATS,
  type Result,
  type Side,
  champion,
  dependents,
  isFormat,
  isRoundRobin,
  matchIds,
  needsFinalists,
  nextMatch,
  resolveBracket,
  standings,
} from "./playoff-bracket";
import { isStrategyAdmin } from "./roles";
import type { AppEnv, TbaTeam } from "./types";
import {
  finiteNumber,
  firstJsonObject,
  id,
  parseJson,
  teamNumber,
  text,
  withTimeout,
} from "./utils";

// Playoff scouting: during an event's playoffs, scouts each take a robot (or a whole alliance's
// strategy) in each match and answer the team's playoff questions. Strategy leads set up a
// session (the bracket, the alliances, how scouts are given slots), start each match and pick
// its winner, which fills in the rest of the bracket. Everyone signed in reads the answers.

type Ctx = Context<AppEnv>;
type SessionRow = typeof playoffSessions.$inferSelect;
type MatchRow = typeof playoffMatches.$inferSelect;

export type PlayoffFieldType =
  | "shortText"
  | "longText"
  | "mcq"
  | "multiSelect"
  | "slider"
  | "counter";
export type PlayoffField = {
  id: string;
  label: string;
  type: PlayoffFieldType;
  options: string[];
  min: number;
  max: number;
  step: number;
  /** Asked about one robot, about the whole alliance, or both. */
  appliesTo: "team" | "overall" | "both";
};
export type Alliance = { seed: number; teams: string[] };
type AssignMode = "claim" | "auto" | "admin";

const FIELD_TYPES: PlayoffFieldType[] = [
  "shortText",
  "longText",
  "mcq",
  "multiSelect",
  "slider",
  "counter",
];
const MAX_FIELDS = 20;
/** Three robots and a backup. */
const MAX_ALLIANCE_TEAMS = 4;

/** The questions a team starts with, the columns of the playoff sheet this replaces. */
export const STARTER_FIELDS: PlayoffField[] = [
  {
    id: "bay",
    label: "Driver station",
    type: "mcq",
    options: ["1", "2", "3"],
    min: 0,
    max: 10,
    step: 1,
    appliesTo: "team",
  },
  ...(
    [
      ["auto", "Auto"],
      ["strategy", "Match strategy"],
      ["notes", "Additional notes"],
    ] as const
  ).map(([fieldId, label]) => ({
    id: fieldId,
    label,
    type: "longText" as const,
    options: [],
    min: 0,
    max: 10,
    step: 1,
    appliesTo: "both" as const,
  })),
];

const ourNumber = (c: Ctx) => requestTeamId(c).replace(/^frc/, "");

// ---------------------------------------------------------------------------------------------
// Parsing what pages send

/** The questions as sent, or a sentence saying what's wrong with them. */
export function parseFields(value: unknown): PlayoffField[] | string {
  if (!Array.isArray(value)) return "Send the questions as a list.";
  if (value.length === 0) return "Add at least one question.";
  if (value.length > MAX_FIELDS) return `A form can have at most ${MAX_FIELDS} questions.`;
  const ids = new Set<string>();
  const fields: PlayoffField[] = [];
  for (const [index, raw] of value.entries()) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const label = text(item.label, 120);
    if (!label) return `Question ${index + 1} needs a label.`;
    const type = FIELD_TYPES.find((t) => t === item.type);
    if (!type) return `${label}: choose a question type.`;
    const fieldId = text(item.id, 80) || crypto.randomUUID();
    if (ids.has(fieldId)) return `${label}: two questions have the same id.`;
    ids.add(fieldId);
    const appliesTo = (["team", "overall", "both"] as const).find((a) => a === item.appliesTo);
    if (!appliesTo) return `${label}: choose who it's asked about.`;
    const options =
      type === "mcq" || type === "multiSelect"
        ? Array.from(
            new Set(
              (Array.isArray(item.options) ? item.options : [])
                .map((option) => text(option, 80))
                .filter(Boolean),
            ),
          ).slice(0, 20)
        : [];
    if ((type === "mcq" || type === "multiSelect") && options.length < 2)
      return `${label}: add at least two choices.`;
    const min = finiteNumber(item.min) ?? 0;
    const max = finiteNumber(item.max) ?? 10;
    const step = finiteNumber(item.step) ?? 1;
    if (type === "slider" && (min >= max || step <= 0))
      return `${label}: the slider's minimum must be below its maximum, with a step above 0.`;
    fields.push({ id: fieldId, label, type, options, min, max, step, appliesTo });
  }
  return fields;
}

/** The answers worth keeping: each in its question's range, anything else left out. */
export function cleanAnswers(fields: PlayoffField[], raw: unknown) {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const answers: Record<string, string | number | string[]> = {};
  for (const field of fields) {
    const value = input[field.id];
    if (field.type === "shortText" || field.type === "longText") {
      const answer = text(value, field.type === "shortText" ? 300 : 3000);
      if (answer) answers[field.id] = answer;
    } else if (field.type === "mcq") {
      if (typeof value === "string" && field.options.includes(value)) answers[field.id] = value;
    } else if (field.type === "multiSelect") {
      const picked = Array.isArray(value)
        ? field.options.filter((option) => value.includes(option))
        : [];
      if (picked.length) answers[field.id] = picked;
    } else if (field.type === "counter") {
      const count = finiteNumber(value);
      if (count !== null && Number.isInteger(count) && count >= 0) answers[field.id] = count;
    } else {
      const rating = finiteNumber(value);
      const steps = rating === null ? 0.5 : (rating - field.min) / field.step;
      if (
        rating !== null &&
        rating >= field.min &&
        rating <= field.max &&
        Math.abs(steps - Math.round(steps)) < 1e-9
      )
        answers[field.id] = rating;
    }
  }
  return answers;
}

/** The questions a slot is asked: "red:overall" gets the whole-alliance ones. */
export function fieldsForSlot(fields: PlayoffField[], slot: string) {
  const overall = slot.endsWith(":overall");
  return fields.filter(
    (field) => field.appliesTo === "both" || field.appliesTo === (overall ? "overall" : "team"),
  );
}

/**
 * The alliances as sent, one per seed of the format, each with up to four team numbers (the
 * fourth a backup). `complete` also asks for three robots on every alliance and no team twice.
 */
export function parseAlliances(
  value: unknown,
  format: BracketFormat,
  complete: boolean,
): Alliance[] | string {
  const count = FORMATS[format].alliances;
  const list = Array.isArray(value) ? value : [];
  const alliances: Alliance[] = [];
  for (let seed = 1; seed <= count; seed += 1) {
    const raw = list.find(
      (item) => item && typeof item === "object" && Number((item as Alliance).seed) === seed,
    ) as Record<string, unknown> | undefined;
    const teams = (Array.isArray(raw?.teams) ? raw.teams : [])
      .slice(0, MAX_ALLIANCE_TEAMS)
      .map((team) => teamNumber(team, false));
    while (teams.length && !teams[teams.length - 1]) teams.pop();
    alliances.push({ seed, teams });
  }
  if (!complete) return alliances;
  const seen = new Set<string>();
  for (const alliance of alliances) {
    if (alliance.teams.slice(0, 3).filter(Boolean).length < 3)
      return `Alliance ${alliance.seed} needs three teams.`;
    for (const team of alliance.teams.filter(Boolean)) {
      if (seen.has(team)) return `Team ${team} is on two alliances.`;
      seen.add(team);
    }
  }
  return alliances;
}

// ---------------------------------------------------------------------------------------------
// Reading a session

export async function playoffFields(db: Db, teamId: string) {
  const row = await db.select().from(playoffForms).where(inTeam(playoffForms, teamId)).get();
  const saved = row ? parseFields(parseJson(row.fields_json, [])) : null;
  return Array.isArray(saved) ? saved : STARTER_FIELDS;
}

async function activeSession(db: Db, teamId: string) {
  return (
    (await db
      .select()
      .from(playoffSessions)
      .where(inTeam(playoffSessions, teamId, inArray(playoffSessions.status, ["setup", "live"])))
      .get()) ?? null
  );
}

function formatOf(session: SessionRow): BracketFormat {
  return isFormat(session.format) ? session.format : "double8";
}

function alliancesOf(session: SessionRow) {
  const parsed = parseAlliances(parseJson(session.alliances_json, []), formatOf(session), false);
  return Array.isArray(parsed) ? parsed : [];
}

async function matchRows(db: Db, teamId: string, sessionId: string) {
  const rows = await db
    .select()
    .from(playoffMatches)
    .where(inTeam(playoffMatches, teamId, eq(playoffMatches.session_id, sessionId)))
    .all();
  return new Map(rows.map((row) => [row.match_id, row]));
}

/** A round robin's finalists, when a strategy lead chose them. */
function chosenFinalists(session: SessionRow): [number, number] | null {
  const chosen = parseJson<unknown>(session.finalists_json, null);
  return Array.isArray(chosen) && chosen.length === 2 && chosen.every(Number.isInteger)
    ? [chosen[0], chosen[1]]
    : null;
}

function bracketOf(session: SessionRow, rows: Map<string, MatchRow>) {
  const results = Object.fromEntries(
    Array.from(rows.values()).map((row) => [row.match_id, row.winner as Result | null]),
  );
  return resolveBracket(formatOf(session), results, chosenFinalists(session));
}

/** The robots an alliance has on the field in a match: the lineup set for it, else its first three. */
function lineup(alliances: Alliance[], seed: number | null, saved: string | undefined) {
  if (!seed) return [];
  const chosen = parseJson<string[]>(saved, []);
  if (chosen.length) return chosen;
  return (alliances.find((alliance) => alliance.seed === seed)?.teams ?? [])
    .slice(0, 3)
    .filter(Boolean);
}

type Slot = { slot: string; side: Side; seed: number; team: string };

/** What can be scouted in a match: each alliance's robots on the field and the alliance as a whole. */
function slotsOf(match: BracketMatch, alliances: Alliance[], row: MatchRow | undefined): Slot[] {
  const slots: Slot[] = [];
  for (const side of ["red", "blue"] as const) {
    const seed = match[side];
    if (!seed) continue;
    slots.push({ slot: `${side}:overall`, side, seed, team: "" });
    for (const team of lineup(
      alliances,
      seed,
      side === "red" ? row?.red_teams_json : row?.blue_teams_json,
    ))
      slots.push({ slot: `${side}:${team}`, side, seed, team });
  }
  return slots;
}

/**
 * The match whose reports are still taken: the last one started. A match's reports close when
 * the next match starts, so scouts can finish typing after the result is in.
 */
function openMatchId(rows: Map<string, MatchRow>) {
  let latest: MatchRow | null = null;
  for (const row of rows.values())
    if (row.started_at && (!latest || row.started_at > (latest.started_at ?? 0))) latest = row;
  return latest?.match_id ?? null;
}

function sessionSummary(session: SessionRow) {
  return {
    id: session.id,
    eventName: session.event_name,
    format: formatOf(session),
    status: session.status as "setup" | "live" | "finished",
    createdAt: session.created_at,
    startedAt: session.started_at,
    finishedAt: session.finished_at,
  };
}

/** The bracket with each match's robots, for the pages. */
function bracketView(session: SessionRow, rows: Map<string, MatchRow>, ours: string) {
  const alliances = alliancesOf(session);
  const ourSeed = alliances.find((alliance) => alliance.teams.includes(ours))?.seed ?? null;
  const bracket = bracketOf(session, rows);
  return {
    ourSeed,
    alliances,
    champion: champion(bracket),
    roundRobin: isRoundRobin(formatOf(session)),
    standings: standings(formatOf(session), bracket),
    needsFinalists: needsFinalists(formatOf(session), bracket),
    bracket: bracket.map((match) => {
      const row = rows.get(match.id);
      return {
        ...match,
        redTeams: lineup(alliances, match.red, row?.red_teams_json),
        blueTeams: lineup(alliances, match.blue, row?.blue_teams_json),
        startedAt: row?.started_at ?? null,
        decidedAt: row?.decided_at ?? null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Changing a session

/** A match's row, made when it first needs one (it holds its lineup, start and result). */
function ensureMatchRow(db: Db, teamId: string, sessionId: string, matchId: string) {
  return db
    .insert(playoffMatches)
    .values(withTeam(teamId, { session_id: sessionId, match_id: matchId }))
    .onConflictDoNothing();
}

/**
 * Gives every participant without a slot in the match a free one: whole-alliance slots first,
 * then robots, with the people who have scouted least going first. Our own alliance is left out
 * when the session says so. Each claim is its own insert that a taken slot simply skips.
 */
async function autoAssign(c: Ctx, session: SessionRow, matchId: string, assignedBy: string) {
  const db = dbOf(c);
  const teamId = c.get("teamId");
  const rows = await matchRows(db, teamId, session.id);
  const match = bracketOf(session, rows).find((item) => item.id === matchId);
  if (!match || match.winner) return;
  const alliances = alliancesOf(session);
  const ourSeed = alliances.find((alliance) => alliance.teams.includes(ourNumber(c)))?.seed;
  const slots = slotsOf(match, alliances, rows.get(matchId)).filter(
    (slot) => !(session.skip_own && slot.seed === ourSeed),
  );
  const ordered = [
    ...slots.filter((slot) => !slot.team),
    ...slots
      .filter((slot) => slot.team && slot.side === "red")
      .flatMap((red, index) => {
        const blue = slots.filter((slot) => slot.team && slot.side === "blue")[index];
        return blue ? [red, blue] : [red];
      }),
    ...slots
      .filter((slot) => slot.team && slot.side === "blue")
      .slice(slots.filter((slot) => slot.team && slot.side === "red").length),
  ];
  const claims = await db
    .select()
    .from(playoffClaims)
    .where(inTeam(playoffClaims, teamId, eq(playoffClaims.session_id, session.id)))
    .all();
  const inMatch = claims.filter((claim) => claim.match_id === matchId);
  const taken = new Set(inMatch.map((claim) => claim.slot));
  const busy = new Set(inMatch.map((claim) => claim.user_id));
  const scouted = new Map<string, number>();
  for (const claim of claims) scouted.set(claim.user_id, (scouted.get(claim.user_id) ?? 0) + 1);
  const people = (
    await db
      .select()
      .from(playoffParticipants)
      .where(inTeam(playoffParticipants, teamId, eq(playoffParticipants.session_id, session.id)))
      .orderBy(asc(playoffParticipants.joined_at))
      .all()
  )
    .filter((person) => !busy.has(person.user_id))
    .sort((a, b) => (scouted.get(a.user_id) ?? 0) - (scouted.get(b.user_id) ?? 0));
  const free = ordered.filter((slot) => !taken.has(slot.slot));
  const statements: WriteQuery[] = people.slice(0, free.length).map((person, index) =>
    db
      .insert(playoffClaims)
      .values(
        withTeam(teamId, {
          session_id: session.id,
          match_id: matchId,
          slot: free[index].slot,
          user_id: person.user_id,
          display_name: person.display_name,
          assigned_by: assignedBy,
          claimed_at: Date.now(),
        }),
      )
      .onConflictDoNothing(),
  );
  await batch(db, statements);
}

/** Moves the session on to the next match to be played (none once the playoffs are won). */
async function advance(c: Ctx, session: SessionRow) {
  const db = dbOf(c);
  const teamId = c.get("teamId");
  const bracket = bracketOf(session, await matchRows(db, teamId, session.id));
  const next = champion(bracket) ? null : nextMatch(bracket);
  const statements: WriteQuery[] = [
    db
      .update(playoffSessions)
      .set({ current_match_id: next?.id ?? null, updated_at: Date.now() })
      .where(inTeam(playoffSessions, teamId, eq(playoffSessions.id, session.id))),
  ];
  if (next) statements.push(ensureMatchRow(db, teamId, session.id, next.id));
  await batch(db, statements);
  if (next && session.assign_mode === "auto")
    await autoAssign(c, { ...session, current_match_id: next.id }, next.id, "auto");
}

// ---------------------------------------------------------------------------------------------
// Reading alliances from The Blue Alliance or a photo

async function eventKeyOf(db: Db, teamId: string) {
  const config = await db
    .select({
      event_key: strategyEventConfig.event_key,
      tba_auth_key: strategyEventConfig.tba_auth_key,
    })
    .from(strategyEventConfig)
    .where(inTeam(strategyEventConfig, teamId, eq(strategyEventConfig.id, 1)))
    .get();
  return config ?? null;
}

type TbaAlliance = { name?: string | null; picks?: string[]; backup?: { in?: string } | null };

/** An event's alliances as The Blue Alliance has them, in seed order with any backup fourth. */
export function alliancesFromTba(rows: TbaAlliance[]): Alliance[] {
  return rows.map((row, index) => {
    const named = Number(String(row.name ?? "").match(/\d+/)?.[0]);
    const teams = (row.picks ?? []).map((key) => teamNumber(key.replace(/^frc/, ""), false));
    const backup = row.backup?.in ? teamNumber(row.backup.in.replace(/^frc/, ""), false) : "";
    if (backup && teams.length < MAX_ALLIANCE_TEAMS && !teams.includes(backup)) teams.push(backup);
    return { seed: Number.isInteger(named) && named > 0 ? named : index + 1, teams };
  });
}

/** Turns what the photo scan answered into alliances by seed. */
export function alliancesFromScan(output: unknown): Alliance[] {
  const rows =
    (output && typeof output === "object" ? (output as { alliances?: unknown }).alliances : null) ??
    [];
  if (!Array.isArray(rows)) return [];
  const bySeed = new Map<number, string[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const seed = Number((row as { n?: unknown }).n);
    const teams = (row as { t?: unknown }).t;
    if (!Number.isInteger(seed) || seed < 1 || seed > 8 || !Array.isArray(teams)) continue;
    bySeed.set(
      seed,
      teams.slice(0, MAX_ALLIANCE_TEAMS).map((team) => teamNumber(team, false)),
    );
  }
  return Array.from(bySeed.entries())
    .sort(([a], [b]) => a - b)
    .map(([seed, teams]) => ({ seed, teams }));
}

const SCAN_PROMPT = `Read this photo of an FRC playoff alliance selection table. Each row is an alliance: its number (1 to 8), then its team numbers left to right (captain, first pick, second pick, and a fourth team if one is shown).
Copy every digit exactly. Keep the alliance number separate from the team numbers. Use null for a team cell you cannot read; never guess a digit.
Return ONLY compact JSON: {"alliances":[{"n":1,"t":[1261,1771,4509]}]}. No names, markdown or explanations.`;

async function visionText(result: unknown) {
  if (result instanceof Response) return result.text();
  if (result instanceof ReadableStream) return new Response(result).text();
  if (typeof result === "string") return result;
  const output = result as {
    response?: string;
    result?: string;
    choices?: { message?: { content?: string } }[];
  };
  return String(output.response ?? output.result ?? output.choices?.[0]?.message?.content ?? "");
}

// ---------------------------------------------------------------------------------------------
// Routes

export const playoffRoutes = new Hono<AppEnv>();

const leadsOnly = (c: Ctx) => c.json({ error: "Only strategy leads can do this." }, 403);
const noSession = (c: Ctx) => c.json({ error: "Playoff scouting isn't running." }, 409);

/** Everything the Playoff Scouting page shows, asked every few seconds while it's open. */
playoffRoutes.get("/playoffs", requireAuth, async (c) => {
  const db = dbOf(c);
  const teamId = c.get("teamId");
  const canManage = await isStrategyAdmin(c);
  const ours = ourNumber(c);
  const base = {
    canManage,
    ourTeam: ours,
    formats: Object.entries(FORMATS).map(([key, format]) => ({
      id: key,
      label: format.label,
      alliances: format.alliances,
    })),
    questions: await playoffFields(db, teamId),
  };
  const session = await activeSession(db, teamId);
  if (!session || (session.status === "setup" && !canManage))
    return c.json({ ...base, session: null });
  const rows = await matchRows(db, teamId, session.id);
  const view = bracketView(session, rows, ours);
  const [claims, participants, mine] = await Promise.all([
    db
      .select()
      .from(playoffClaims)
      .where(inTeam(playoffClaims, teamId, eq(playoffClaims.session_id, session.id)))
      .all(),
    db
      .select()
      .from(playoffParticipants)
      .where(inTeam(playoffParticipants, teamId, eq(playoffParticipants.session_id, session.id)))
      .orderBy(asc(playoffParticipants.joined_at))
      .all(),
    db
      .select()
      .from(playoffReports)
      .where(
        inTeam(
          playoffReports,
          teamId,
          eq(playoffReports.session_id, session.id),
          eq(playoffReports.submitted_by, c.get("userId")),
        ),
      )
      .all(),
  ]);
  const openMatch = session.status === "live" ? openMatchId(rows) : null;
  const matchView = (matchId: string | null) => {
    const match = view.bracket.find((item) => item.id === matchId);
    if (!match) return null;
    return {
      ...match,
      slots: slotsOf(match, view.alliances, rows.get(match.id)).map((slot) => {
        const claim = claims.find((item) => item.match_id === match.id && item.slot === slot.slot);
        return {
          ...slot,
          claim: claim ? { userId: claim.user_id, name: claim.display_name } : null,
        };
      }),
    };
  };
  const scouted = new Map<string, number>();
  for (const claim of claims) scouted.set(claim.user_id, (scouted.get(claim.user_id) ?? 0) + 1);
  return c.json({
    ...base,
    session: {
      ...sessionSummary(session),
      assignMode: session.assign_mode as AssignMode,
      skipOwn: Boolean(session.skip_own),
      currentMatchId: session.current_match_id,
      openMatchId: openMatch,
      ...view,
      current: matchView(session.current_match_id),
      // The match still taking reports, when the next one hasn't started yet.
      open: openMatch && openMatch !== session.current_match_id ? matchView(openMatch) : null,
      participants: participants.map((person) => ({
        userId: person.user_id,
        name: person.display_name,
        scouted: scouted.get(person.user_id) ?? 0,
      })),
      me: {
        joined: participants.some((person) => person.user_id === c.get("userId")),
        reports: mine
          .filter((report) => report.match_id === openMatch)
          .map((report) => ({
            matchId: report.match_id,
            slot: report.slot,
            answers: parseJson<Record<string, unknown>>(report.answers_json, {}),
            updatedAt: report.updated_at,
          })),
      },
    },
  });
});

// The questions (kept from event to event)

playoffRoutes.put("/playoffs/questions", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const body = await c.req.json<{ fields?: unknown }>().catch(() => ({}) as { fields?: unknown });
  const fields = parseFields(body.fields);
  if (typeof fields === "string") return c.json({ error: fields }, 400);
  await dbOf(c)
    .insert(playoffForms)
    .values(
      withTeam(c.get("teamId"), {
        fields_json: JSON.stringify(fields),
        updated_by: c.get("userId"),
        updated_at: Date.now(),
      }),
    )
    .onConflictDoUpdate({
      target: [playoffForms.teamId],
      set: {
        fields_json: sql`excluded.fields_json`,
        updated_by: sql`excluded.updated_by`,
        updated_at: sql`excluded.updated_at`,
      },
    })
    .run();
  return c.json({ fields });
});

// Setting up, starting and finishing

playoffRoutes.post("/playoffs/setup", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const body = await c.req
    .json<{ eventName?: unknown; format?: unknown }>()
    .catch(() => ({}) as { eventName?: unknown; format?: unknown });
  const format = isFormat(body.format) ? body.format : "double8";
  const db = dbOf(c);
  const config = await eventKeyOf(db, c.get("teamId"));
  const now = Date.now();
  const created = await db
    .insert(playoffSessions)
    .values(
      withTeam(c.get("teamId"), {
        id: id("playoffs"),
        event_name: text(body.eventName, 120) || config?.event_key || "Playoffs",
        format,
        status: "setup",
        alliances_json: JSON.stringify(
          Array.from({ length: FORMATS[format].alliances }, (_, index) => ({
            seed: index + 1,
            teams: [],
          })),
        ),
        created_by: c.get("userId"),
        created_at: now,
        updated_at: now,
      }),
    )
    .onConflictDoNothing()
    .returning()
    .get();
  if (!created) return c.json({ error: "Playoff scouting is already set up." }, 409);
  return c.json({ session: sessionSummary(created) }, 201);
});

playoffRoutes.put("/playoffs/setup", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const db = dbOf(c);
  const session = await activeSession(db, c.get("teamId"));
  if (!session) return noSession(c);
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  const change: Partial<SessionRow> = { updated_at: Date.now() };
  if (body.eventName !== undefined) {
    const name = text(body.eventName, 120);
    if (!name) return c.json({ error: "Give the event a name." }, 400);
    change.event_name = name;
  }
  let format = formatOf(session);
  if (body.format !== undefined) {
    if (!isFormat(body.format)) return c.json({ error: "Choose a bracket." }, 400);
    if (session.status !== "setup" && body.format !== format)
      return c.json({ error: "The bracket can't change once playoff scouting has started." }, 409);
    format = body.format;
    change.format = format;
  }
  if (body.alliances !== undefined || change.format) {
    // Live, every alliance still needs its three robots; while setting up, gaps are fine.
    const alliances = parseAlliances(
      body.alliances ?? alliancesOf(session),
      format,
      session.status === "live",
    );
    if (typeof alliances === "string") return c.json({ error: alliances }, 400);
    change.alliances_json = JSON.stringify(alliances);
  }
  if (body.assignMode !== undefined) {
    if (!["claim", "auto", "admin"].includes(String(body.assignMode)))
      return c.json({ error: "Choose how scouts get their slots." }, 400);
    change.assign_mode = String(body.assignMode);
  }
  if (body.skipOwn !== undefined) change.skip_own = body.skipOwn ? 1 : 0;
  await db
    .update(playoffSessions)
    .set(change)
    .where(inTeam(playoffSessions, c.get("teamId"), eq(playoffSessions.id, session.id)))
    .run();
  const updated = { ...session, ...change };
  if (change.assign_mode === "auto" && session.status === "live" && session.current_match_id)
    await autoAssign(c, updated, session.current_match_id, "auto");
  return c.json({ session: sessionSummary(updated) });
});

playoffRoutes.delete("/playoffs/setup", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const db = dbOf(c);
  const session = await activeSession(db, c.get("teamId"));
  if (!session) return noSession(c);
  if (session.status !== "setup")
    return c.json({ error: "Finish playoff scouting instead: it has already started." }, 409);
  await db
    .delete(playoffSessions)
    .where(inTeam(playoffSessions, c.get("teamId"), eq(playoffSessions.id, session.id)))
    .run();
  return c.json({ ok: true });
});

playoffRoutes.post("/playoffs/start", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const db = dbOf(c);
  const session = await activeSession(db, c.get("teamId"));
  if (!session) return noSession(c);
  if (session.status !== "setup")
    return c.json({ error: "Playoff scouting has already started." }, 409);
  const alliances = parseAlliances(alliancesOf(session), formatOf(session), true);
  if (typeof alliances === "string") return c.json({ error: alliances }, 400);
  const now = Date.now();
  const updated = await db
    .update(playoffSessions)
    .set({ status: "live", started_at: now, updated_at: now })
    .where(
      inTeam(
        playoffSessions,
        c.get("teamId"),
        eq(playoffSessions.id, session.id),
        eq(playoffSessions.status, "setup"),
      ),
    )
    .returning()
    .get();
  if (!updated) return c.json({ error: "Playoff scouting has already started." }, 409);
  await advance(c, updated);
  return c.json({ ok: true });
});

playoffRoutes.post("/playoffs/finish", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const db = dbOf(c);
  const session = await activeSession(db, c.get("teamId"));
  if (!session || session.status !== "live") return noSession(c);
  const now = Date.now();
  await db
    .update(playoffSessions)
    .set({ status: "finished", finished_at: now, current_match_id: null, updated_at: now })
    .where(inTeam(playoffSessions, c.get("teamId"), eq(playoffSessions.id, session.id)))
    .run();
  return c.json({ ok: true });
});

// Filling in the alliances

playoffRoutes.post("/playoffs/alliances/tba", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const body = await c.req
    .json<{ eventKey?: unknown }>()
    .catch(() => ({}) as { eventKey?: unknown });
  const config = await eventKeyOf(dbOf(c), c.get("teamId"));
  const eventKey = text(body.eventKey, 40).toLowerCase() || config?.event_key || "";
  if (!/^\d{4}[a-z0-9]+$/.test(eventKey))
    return c.json({ error: "Set the event on Scouting's Admin page first." }, 400);
  const authKey = teamApiKey(c.get("teamId"), config?.tba_auth_key, c.env.TBA_AUTH_KEY);
  if (!authKey) return c.json({ error: "The Blue Alliance isn't connected for your team." }, 400);
  const response = await fetch(
    `https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(eventKey)}/alliances`,
    { headers: { "X-TBA-Auth-Key": authKey } },
  ).catch(() => null);
  if (!response?.ok)
    return c.json({ error: "Couldn't reach The Blue Alliance. Try again, or fill them in." }, 502);
  const alliances = alliancesFromTba(((await response.json()) as TbaAlliance[] | null) ?? []);
  if (!alliances.length)
    return c.json({ error: "The Blue Alliance doesn't have this event's alliances yet." }, 404);
  return c.json({ eventKey, alliances });
});

playoffRoutes.post("/playoffs/alliances/scan", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/"))
    return c.json({ error: "Choose a photo of the alliances." }, 400);
  if (file.size > 15_000_000) return c.json({ error: "The photo must be under 15 MB." }, 413);
  const db = dbOf(c);
  const teamId = c.get("teamId");
  // Shares the schedule scan's hourly allowance of 12 scans per person.
  const window = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const usage = await db
    .select({ page_count: manualScanUsage.page_count })
    .from(manualScanUsage)
    .where(
      inTeam(
        manualScanUsage,
        teamId,
        eq(manualScanUsage.user_id, c.get("userId")),
        eq(manualScanUsage.window_started_at, window),
      ),
    )
    .get();
  if ((usage?.page_count ?? 0) >= 12)
    return c.json(
      { error: "You've scanned 12 photos this hour. Fill the alliances in by hand." },
      429,
    );
  await db
    .insert(manualScanUsage)
    .values(
      withTeam(teamId, { user_id: c.get("userId"), window_started_at: window, page_count: 1 }),
    )
    .onConflictDoUpdate({
      target: [manualScanUsage.teamId, manualScanUsage.user_id, manualScanUsage.window_started_at],
      set: { page_count: sql`page_count + 1` },
    })
    .run();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + 32_768)));
  let alliances: Alliance[];
  try {
    const result = await withTimeout(
      c.env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: SCAN_PROMPT },
              { type: "image_url", image_url: { url: `data:${file.type};base64,${btoa(binary)}` } },
            ],
          },
        ],
        max_tokens: 512,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
      } as never),
      30_000,
      "Image scan",
    );
    alliances = alliancesFromScan(JSON.parse(firstJsonObject(await visionText(result)) || "{}"));
  } catch {
    return c.json({ error: "Couldn't read that photo. Try a closer one, or fill them in." }, 502);
  }
  if (!alliances.length)
    return c.json(
      { error: "No alliances found in that photo. Try a closer one, or fill them in." },
      422,
    );
  // Numbers that aren't at the event, when we know who is, so the page can mark them to check.
  const config = await eventKeyOf(db, teamId);
  const cached = config?.event_key
    ? await db
        .select({ teams_json: tbaTeamCache.teams_json })
        .from(tbaTeamCache)
        .where(eq(tbaTeamCache.event_key, config.event_key))
        .get()
    : null;
  const atEvent = new Set(
    parseJson<TbaTeam[]>(cached?.teams_json, []).map((team) => String(team.team_number)),
  );
  const unknown = atEvent.size
    ? alliances.flatMap((alliance) => alliance.teams).filter((team) => team && !atEvent.has(team))
    : [];
  return c.json({ alliances, unknown });
});

// Joining and slots

playoffRoutes.post("/playoffs/join", requireAuth, async (c) => {
  const db = dbOf(c);
  const session = await activeSession(db, c.get("teamId"));
  if (!session || session.status !== "live") return noSession(c);
  await db
    .insert(playoffParticipants)
    .values(
      withTeam(c.get("teamId"), {
        session_id: session.id,
        user_id: c.get("userId"),
        display_name: c.get("userDisplayName") || "Scout",
        joined_at: Date.now(),
      }),
    )
    .onConflictDoNothing()
    .run();
  if (session.assign_mode === "auto" && session.current_match_id)
    await autoAssign(c, session, session.current_match_id, "auto");
  return c.json({ ok: true });
});

playoffRoutes.post("/playoffs/leave", requireAuth, async (c) => {
  const db = dbOf(c);
  const teamId = c.get("teamId");
  const session = await activeSession(db, teamId);
  if (!session) return noSession(c);
  const rows = await matchRows(db, teamId, session.id);
  const decided = Array.from(rows.values())
    .filter((row) => row.winner)
    .map((row) => row.match_id);
  await batch(db, [
    db
      .delete(playoffParticipants)
      .where(
        inTeam(
          playoffParticipants,
          teamId,
          eq(playoffParticipants.session_id, session.id),
          eq(playoffParticipants.user_id, c.get("userId")),
        ),
      ),
    // Slots in matches still to come go back to the others; past ones stay as a record.
    db
      .delete(playoffClaims)
      .where(
        inTeam(
          playoffClaims,
          teamId,
          eq(playoffClaims.session_id, session.id),
          eq(playoffClaims.user_id, c.get("userId")),
          decided.length ? notInArray(playoffClaims.match_id, decided) : undefined,
        ),
      ),
  ]);
  return c.json({ ok: true });
});

/** The live session and one of its matches, for the routes that change a match. */
async function liveMatch(c: Ctx, matchId: string) {
  const db = dbOf(c);
  const session = await activeSession(db, c.get("teamId"));
  if (!session || session.status !== "live") return null;
  const rows = await matchRows(db, c.get("teamId"), session.id);
  const match = bracketOf(session, rows).find((item) => item.id === matchId);
  if (!match) return null;
  return { session, rows, match, alliances: alliancesOf(session) };
}

/** Puts a person in a slot of the match, out of any other slot they had in it, unless it's taken. */
async function takeSlot(
  c: Ctx,
  sessionId: string,
  matchId: string,
  slot: string,
  person: { userId: string; name: string },
  assignedBy: string | null,
) {
  const db = dbOf(c);
  const teamId = c.get("teamId");
  await batch(db, [
    db.delete(playoffClaims).where(
      inTeam(
        playoffClaims,
        teamId,
        eq(playoffClaims.session_id, sessionId),
        eq(playoffClaims.match_id, matchId),
        eq(playoffClaims.user_id, person.userId),
        sql`NOT EXISTS (SELECT 1 FROM (SELECT * FROM ${playoffClaims} WHERE ${inTeam(playoffClaims, teamId)}) AS taken
            WHERE taken.session_id = ${sessionId} AND taken.match_id = ${matchId}
              AND taken.slot = ${slot} AND taken.user_id <> ${person.userId})`,
      ),
    ),
    db
      .insert(playoffClaims)
      .values(
        withTeam(teamId, {
          session_id: sessionId,
          match_id: matchId,
          slot,
          user_id: person.userId,
          display_name: person.name,
          assigned_by: assignedBy,
          claimed_at: Date.now(),
        }),
      )
      .onConflictDoNothing(),
  ]);
  const holder = await db
    .select({ user_id: playoffClaims.user_id })
    .from(playoffClaims)
    .where(
      inTeam(
        playoffClaims,
        teamId,
        eq(playoffClaims.session_id, sessionId),
        eq(playoffClaims.match_id, matchId),
        eq(playoffClaims.slot, slot),
      ),
    )
    .get();
  return holder?.user_id === person.userId;
}

playoffRoutes.put("/playoffs/matches/:matchId/claim", requireAuth, async (c) => {
  const live = await liveMatch(c, c.req.param("matchId"));
  if (!live) return noSession(c);
  const { session, rows, match, alliances } = live;
  if (session.current_match_id !== match.id || match.winner)
    return c.json({ error: "Slots are taken for the match being played." }, 409);
  if (session.assign_mode !== "claim")
    return c.json({ error: "Strategy leads are giving out slots for this match." }, 403);
  const db = dbOf(c);
  const joined = await db
    .select({ user_id: playoffParticipants.user_id })
    .from(playoffParticipants)
    .where(
      inTeam(
        playoffParticipants,
        c.get("teamId"),
        eq(playoffParticipants.session_id, session.id),
        eq(playoffParticipants.user_id, c.get("userId")),
      ),
    )
    .get();
  if (!joined) return c.json({ error: "Join playoff scouting first." }, 403);
  const body = await c.req.json<{ slot?: unknown }>().catch(() => ({}) as { slot?: unknown });
  const slot = text(body.slot, 40);
  if (!slotsOf(match, alliances, rows.get(match.id)).some((item) => item.slot === slot))
    return c.json({ error: "That isn't in this match." }, 400);
  const taken = await takeSlot(
    c,
    session.id,
    match.id,
    slot,
    { userId: c.get("userId"), name: c.get("userDisplayName") || "Scout" },
    null,
  );
  if (!taken) return c.json({ error: "Someone else just took that one." }, 409);
  return c.json({ ok: true });
});

playoffRoutes.delete("/playoffs/matches/:matchId/claim", requireAuth, async (c) => {
  const live = await liveMatch(c, c.req.param("matchId"));
  if (!live) return noSession(c);
  if (live.session.assign_mode !== "claim" && !(await isStrategyAdmin(c)))
    return c.json({ error: "Ask a strategy lead to change your slot." }, 403);
  await dbOf(c)
    .delete(playoffClaims)
    .where(
      inTeam(
        playoffClaims,
        c.get("teamId"),
        eq(playoffClaims.session_id, live.session.id),
        eq(playoffClaims.match_id, live.match.id),
        eq(playoffClaims.user_id, c.get("userId")),
      ),
    )
    .run();
  return c.json({ ok: true });
});

playoffRoutes.put("/playoffs/matches/:matchId/assign", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const live = await liveMatch(c, c.req.param("matchId"));
  if (!live) return noSession(c);
  const { session, rows, match, alliances } = live;
  if (match.winner) return c.json({ error: "This match is over." }, 409);
  const body = await c.req
    .json<{ slot?: unknown; userId?: unknown }>()
    .catch(() => ({}) as { slot?: unknown; userId?: unknown });
  const slot = text(body.slot, 40);
  if (!slotsOf(match, alliances, rows.get(match.id)).some((item) => item.slot === slot))
    return c.json({ error: "That isn't in this match." }, 400);
  const db = dbOf(c);
  const teamId = c.get("teamId");
  const clearSlot = db
    .delete(playoffClaims)
    .where(
      inTeam(
        playoffClaims,
        teamId,
        eq(playoffClaims.session_id, session.id),
        eq(playoffClaims.match_id, match.id),
        eq(playoffClaims.slot, slot),
      ),
    );
  if (!body.userId) {
    await clearSlot.run();
    return c.json({ ok: true });
  }
  const person = await db
    .select()
    .from(playoffParticipants)
    .where(
      inTeam(
        playoffParticipants,
        teamId,
        eq(playoffParticipants.session_id, session.id),
        eq(playoffParticipants.user_id, text(body.userId, 120)),
      ),
    )
    .get();
  if (!person) return c.json({ error: "They haven't joined playoff scouting." }, 400);
  await clearSlot.run();
  await takeSlot(
    c,
    session.id,
    match.id,
    slot,
    { userId: person.user_id, name: person.display_name },
    c.get("userId"),
  );
  return c.json({ ok: true });
});

playoffRoutes.post("/playoffs/matches/:matchId/auto-assign", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const live = await liveMatch(c, c.req.param("matchId"));
  if (!live) return noSession(c);
  await autoAssign(c, live.session, live.match.id, c.get("userId"));
  return c.json({ ok: true });
});

playoffRoutes.put("/playoffs/matches/:matchId/lineup", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const live = await liveMatch(c, c.req.param("matchId"));
  if (!live) return noSession(c);
  const { session, rows, match, alliances } = live;
  if (match.winner) return c.json({ error: "This match is over." }, 409);
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  const chosen: Record<Side, string[]> = { red: [], blue: [] };
  for (const side of ["red", "blue"] as const) {
    const seed = match[side];
    if (!seed) return c.json({ error: "This match's alliances aren't known yet." }, 409);
    const roster = alliances.find((alliance) => alliance.seed === seed)?.teams ?? [];
    const teams = Array.from(
      new Set(
        (Array.isArray(body[side]) ? (body[side] as unknown[]) : []).map((t) =>
          teamNumber(t, false),
        ),
      ),
    );
    if (!teams.length || teams.length > 3 || teams.some((team) => !roster.includes(team)))
      return c.json({ error: `Alliance ${seed} plays one to three of its own robots.` }, 400);
    chosen[side] = teams;
  }
  const db = dbOf(c);
  const teamId = c.get("teamId");
  const valid = slotsOf(match, alliances, {
    ...(rows.get(match.id) as MatchRow),
    red_teams_json: JSON.stringify(chosen.red),
    blue_teams_json: JSON.stringify(chosen.blue),
  }).map((slot) => slot.slot);
  await batch(db, [
    ensureMatchRow(db, teamId, session.id, match.id),
    db
      .update(playoffMatches)
      .set({
        red_teams_json: JSON.stringify(chosen.red),
        blue_teams_json: JSON.stringify(chosen.blue),
      })
      .where(
        inTeam(
          playoffMatches,
          teamId,
          eq(playoffMatches.session_id, session.id),
          eq(playoffMatches.match_id, match.id),
        ),
      ),
    // A robot taken off the field takes its slot with it.
    db
      .delete(playoffClaims)
      .where(
        inTeam(
          playoffClaims,
          teamId,
          eq(playoffClaims.session_id, session.id),
          eq(playoffClaims.match_id, match.id),
          notInArray(playoffClaims.slot, valid),
        ),
      ),
  ]);
  if (session.assign_mode === "auto") await autoAssign(c, session, match.id, "auto");
  return c.json({ ok: true });
});

playoffRoutes.post("/playoffs/matches/:matchId/start", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const live = await liveMatch(c, c.req.param("matchId"));
  if (!live) return noSession(c);
  const { session, match } = live;
  if (session.current_match_id !== match.id || match.winner)
    return c.json({ error: "Start the match being played." }, 409);
  const db = dbOf(c);
  const teamId = c.get("teamId");
  await batch(db, [
    ensureMatchRow(db, teamId, session.id, match.id),
    db
      .update(playoffMatches)
      .set({ started_at: Date.now() })
      .where(
        inTeam(
          playoffMatches,
          teamId,
          eq(playoffMatches.session_id, session.id),
          eq(playoffMatches.match_id, match.id),
          sql`${playoffMatches.started_at} IS NULL`,
        ),
      ),
  ]);
  return c.json({ ok: true });
});

playoffRoutes.post("/playoffs/matches/:matchId/winner", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const live = await liveMatch(c, c.req.param("matchId"));
  if (!live) return noSession(c);
  const { session, match } = live;
  const body = await c.req.json<{ winner?: unknown }>().catch(() => ({}) as { winner?: unknown });
  const winner =
    body.winner === "red" || body.winner === "blue"
      ? body.winner
      : body.winner === "tie" && match.bracket === "roundrobin"
        ? "tie"
        : null;
  if (!winner) return c.json({ error: "Choose the alliance that won." }, 400);
  if (!match.red || !match.blue || !match.needed)
    return c.json({ error: "This match isn't being played." }, 409);
  if (match.winner) return c.json({ error: "This match already has a winner." }, 409);
  const db = dbOf(c);
  const teamId = c.get("teamId");
  const now = Date.now();
  await batch(db, [
    ensureMatchRow(db, teamId, session.id, match.id),
    db
      .update(playoffMatches)
      .set({
        winner,
        decided_at: now,
        started_at: sql`COALESCE(${playoffMatches.started_at}, ${now})`,
      })
      .where(
        inTeam(
          playoffMatches,
          teamId,
          eq(playoffMatches.session_id, session.id),
          eq(playoffMatches.match_id, match.id),
          sql`${playoffMatches.winner} IS NULL`,
        ),
      ),
  ]);
  await advance(c, session);
  return c.json({ ok: true });
});

/** Takes a winner back (a wrong tap), while nothing that followed from it has started. */
playoffRoutes.delete("/playoffs/matches/:matchId/winner", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const live = await liveMatch(c, c.req.param("matchId"));
  if (!live) return noSession(c);
  const { session, rows, match } = live;
  if (!match.winner) return c.json({ error: "This match has no winner yet." }, 409);
  const later = dependents(formatOf(session), match.id);
  if (later.some((matchId) => rows.get(matchId)?.started_at || rows.get(matchId)?.winner))
    return c.json({ error: "A match that followed from this one has started." }, 409);
  const db = dbOf(c);
  const teamId = c.get("teamId");
  const statements: WriteQuery[] = [
    db
      .update(playoffMatches)
      .set({ winner: null, decided_at: null })
      .where(
        inTeam(
          playoffMatches,
          teamId,
          eq(playoffMatches.session_id, session.id),
          eq(playoffMatches.match_id, match.id),
        ),
      ),
    db
      .update(playoffSessions)
      .set({
        current_match_id: match.id,
        // An open round robin has no finalists yet; they're chosen again once it's over.
        ...(match.bracket === "roundrobin" ? { finalists_json: null } : {}),
        updated_at: Date.now(),
      })
      .where(inTeam(playoffSessions, teamId, eq(playoffSessions.id, session.id))),
  ];
  if (later.length)
    statements.push(
      // The matches it fed may now have other alliances: their slots and lineups start over.
      db
        .delete(playoffClaims)
        .where(
          inTeam(
            playoffClaims,
            teamId,
            eq(playoffClaims.session_id, session.id),
            inArray(playoffClaims.match_id, later),
          ),
        ),
      db
        .delete(playoffMatches)
        .where(
          inTeam(
            playoffMatches,
            teamId,
            eq(playoffMatches.session_id, session.id),
            inArray(playoffMatches.match_id, later),
          ),
        ),
    );
  await batch(db, statements);
  return c.json({ ok: true });
});

/**
 * A round robin's finalists, chosen by a strategy lead: when alliances are level on points for a
 * place in the finals, or to follow the event's own ranking. Higher ranked first (red).
 */
playoffRoutes.put("/playoffs/finalists", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const db = dbOf(c);
  const teamId = c.get("teamId");
  const session = await activeSession(db, teamId);
  if (!session || session.status !== "live") return noSession(c);
  const format = formatOf(session);
  if (!isRoundRobin(format))
    return c.json({ error: "Only a round robin has finalists to choose." }, 400);
  const rows = await matchRows(db, teamId, session.id);
  const bracket = bracketOf(session, rows);
  if (bracket.some((match) => match.bracket === "roundrobin" && !match.winner))
    return c.json({ error: "Every round robin match needs a result first." }, 409);
  if (rows.get("F1")?.started_at) return c.json({ error: "The finals have started." }, 409);
  const body = await c.req.json<{ seeds?: unknown }>().catch(() => ({}) as { seeds?: unknown });
  const seeds = Array.isArray(body.seeds) ? body.seeds.map(Number) : [];
  const count = FORMATS[format].alliances;
  if (
    seeds.length !== 2 ||
    seeds[0] === seeds[1] ||
    seeds.some((seed) => !Number.isInteger(seed) || seed < 1 || seed > count)
  )
    return c.json({ error: "Choose two different alliances." }, 400);
  const finals = matchIds(format).filter((matchId) => matchId.startsWith("F"));
  await batch(db, [
    db
      .update(playoffSessions)
      .set({ finalists_json: JSON.stringify(seeds), updated_at: Date.now() })
      .where(inTeam(playoffSessions, teamId, eq(playoffSessions.id, session.id))),
    // Finals not yet started start over with the alliances chosen.
    db
      .delete(playoffClaims)
      .where(
        inTeam(
          playoffClaims,
          teamId,
          eq(playoffClaims.session_id, session.id),
          inArray(playoffClaims.match_id, finals),
        ),
      ),
    db
      .delete(playoffMatches)
      .where(
        inTeam(
          playoffMatches,
          teamId,
          eq(playoffMatches.session_id, session.id),
          inArray(playoffMatches.match_id, finals),
        ),
      ),
  ]);
  await advance(c, { ...session, finalists_json: JSON.stringify(seeds) });
  return c.json({ ok: true });
});

// Reports

playoffRoutes.put("/playoffs/matches/:matchId/reports/:slot", requireAuth, async (c) => {
  const live = await liveMatch(c, c.req.param("matchId"));
  if (!live) return noSession(c);
  const { session, rows, match, alliances } = live;
  if (openMatchId(rows) !== match.id)
    return c.json({ error: "This match's forms have closed." }, 409);
  const slot = slotsOf(match, alliances, rows.get(match.id)).find(
    (item) => item.slot === c.req.param("slot"),
  );
  if (!slot) return c.json({ error: "That isn't in this match." }, 400);
  const db = dbOf(c);
  const teamId = c.get("teamId");
  const claim = await db
    .select({ user_id: playoffClaims.user_id })
    .from(playoffClaims)
    .where(
      inTeam(
        playoffClaims,
        teamId,
        eq(playoffClaims.session_id, session.id),
        eq(playoffClaims.match_id, match.id),
        eq(playoffClaims.slot, slot.slot),
      ),
    )
    .get();
  if (claim?.user_id !== c.get("userId"))
    return c.json({ error: "This slot isn't yours in this match." }, 403);
  const body = await c.req.json<{ answers?: unknown }>().catch(() => ({}) as { answers?: unknown });
  const fields = fieldsForSlot(await playoffFields(db, teamId), slot.slot);
  const answers = cleanAnswers(fields, body.answers);
  const now = Date.now();
  await db
    .insert(playoffReports)
    .values(
      withTeam(teamId, {
        id: id("playoff_report"),
        session_id: session.id,
        match_id: match.id,
        slot: slot.slot,
        alliance_seed: slot.seed,
        team_number: slot.team,
        answers_json: JSON.stringify(answers),
        fields_json: JSON.stringify(fields),
        submitted_by: c.get("userId"),
        submitted_by_name: c.get("userDisplayName") || "Scout",
        created_at: now,
        updated_at: now,
      }),
    )
    .onConflictDoUpdate({
      target: [
        playoffReports.teamId,
        playoffReports.session_id,
        playoffReports.match_id,
        playoffReports.slot,
        playoffReports.submitted_by,
      ],
      set: {
        answers_json: sql`excluded.answers_json`,
        fields_json: sql`excluded.fields_json`,
        updated_at: sql`excluded.updated_at`,
      },
    })
    .run();
  return c.json({ ok: true, answers, updatedAt: now });
});

// The data, for everyone signed in

playoffRoutes.get("/playoffs/sessions", requireAuth, async (c) => {
  const canManage = await isStrategyAdmin(c);
  const sessions = await dbOf(c)
    .select()
    .from(playoffSessions)
    .where(
      inTeam(
        playoffSessions,
        c.get("teamId"),
        canManage ? undefined : inArray(playoffSessions.status, ["live", "finished"]),
      ),
    )
    .orderBy(desc(playoffSessions.created_at))
    .all();
  return c.json({ sessions: sessions.map(sessionSummary) });
});

playoffRoutes.get("/playoffs/sessions/:id", requireAuth, async (c) => {
  const db = dbOf(c);
  const teamId = c.get("teamId");
  const session = await db
    .select()
    .from(playoffSessions)
    .where(inTeam(playoffSessions, teamId, eq(playoffSessions.id, c.req.param("id"))))
    .get();
  if (!session || (session.status === "setup" && !(await isStrategyAdmin(c))))
    return c.json({ error: "No such playoff session." }, 404);
  const rows = await matchRows(db, teamId, session.id);
  const reports = await db
    .select()
    .from(playoffReports)
    .where(inTeam(playoffReports, teamId, eq(playoffReports.session_id, session.id)))
    .orderBy(asc(playoffReports.created_at))
    .all();
  const order = matchIds(formatOf(session));
  return c.json({
    session: sessionSummary(session),
    ...bracketView(session, rows, ourNumber(c)),
    questions: await playoffFields(db, teamId),
    reports: reports
      .sort((a, b) => order.indexOf(a.match_id) - order.indexOf(b.match_id))
      .map((report) => ({
        id: report.id,
        matchId: report.match_id,
        slot: report.slot,
        seed: report.alliance_seed,
        team: report.team_number,
        answers: parseJson<Record<string, unknown>>(report.answers_json, {}),
        fields: parseJson<PlayoffField[]>(report.fields_json, []),
        by: report.submitted_by_name,
        updatedAt: report.updated_at,
      })),
  });
});

playoffRoutes.delete("/playoffs/sessions/:id", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return leadsOnly(c);
  const deleted = await dbOf(c)
    .delete(playoffSessions)
    .where(
      inTeam(
        playoffSessions,
        c.get("teamId"),
        eq(playoffSessions.id, c.req.param("id")),
        eq(playoffSessions.status, "finished"),
      ),
    )
    .returning({ id: playoffSessions.id })
    .get();
  if (!deleted) return c.json({ error: "Only finished playoff sessions can be deleted." }, 409);
  return c.json({ ok: true });
});
