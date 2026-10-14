import { appAuthContext } from "@g3/auth";
import { inTeam, requestTeamId, withTeam } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { all, batch, dbOf, first } from "./db";
import { adoptLegacyRows, seedTeam } from "./db/bootstrap";
import {
  autoRoutines,
  boylebucksAccounts,
  boylebucksLedger,
  fieldMapPublishers,
  fieldMaps,
  manualEvents,
  manualTeams,
  scoutingFormSubmissions,
  scoutingForms,
  scoutingMatchAssignments,
  serviceHelpers,
  serviceTickets,
  strategyAdmins,
  strategyAnnouncements,
  strategyEventConfig,
  strategyPresence,
  tbaMatchCache,
  tbaTeamCache,
  teamComments as teamCommentsTable,
  tierLists,
} from "./db/schema";
import { getEngagementSettings } from "./engagement";
import { engagementRoutes } from "./engagement-routes";
import { internalRoutes } from "./internal";
import { getManualMatches, manualRoutes, purgeExpiredManualEvents } from "./manual";
import { requireAuth } from "./middleware/auth";
import { predictionsRoutes, settleConfiguredGame } from "./predictions";
import { getG3IdUsers, isServiceHelper, isStrategyAdmin } from "./roles";
import { teamSettingsRouter } from "./team-settings";
import type { AppEnv, TbaMatch, TbaTeam } from "./types";
import { finiteNumber, id, parseJson, stringArray, teamNumber, text } from "./utils";

/** "Our team" for a request: the team the gateway says the page is for (the site team without it). */
const ourTeam = requestTeamId;

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

app.get("/health", (c) =>
  c.json({ status: "ok", service: "scouting", version: packageJson.version }),
);
app.get("/me", requireAuth, async (c) =>
  c.json({
    userId: c.get("userId"),
    displayName: c.get("userDisplayName"),
    email: c.get("userEmail"),
    isAdmin: await isStrategyAdmin(c),
    isG3IdAdmin: c.get("userIsAdmin"),
    isHelper: await isServiceHelper(c),
    engagement: await getEngagementSettings(c.env.SCOUTING_DB, c.get("teamId")),
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
  await dbOf(c)
    .update(strategyEventConfig)
    .set({ current_match_number: match.match_number, updated_at: Date.now() })
    .where(inTeam(strategyEventConfig, c.get("teamId"), sql`id = 1 AND schedule_mode = 'tba'`))
    .run();
}

async function getOrCreateScoutAssignment(
  c: Context<AppEnv>,
  eventKey: string,
  matchNumber: number,
  teams: string[],
) {
  const existing = await first<{ team_number: string }>(
    dbOf(c),
    sql`SELECT team_number FROM (SELECT * FROM ${scoutingMatchAssignments} WHERE ${inTeam(scoutingMatchAssignments, c.get("teamId"))}) AS scoped_scouting_match_assignments WHERE event_key = ${eventKey} AND match_number = ${matchNumber} AND user_id = ${c.get("userId")}`,
  );
  if (existing && teams.includes(existing.team_number)) return existing.team_number;

  const submitted = await first<{ team_name: string }>(
    dbOf(c),
    sql`SELECT s.team_name
       FROM (SELECT * FROM ${scoutingFormSubmissions} WHERE ${inTeam(scoutingFormSubmissions, c.get("teamId"))}) AS s
       JOIN (SELECT * FROM ${scoutingForms} WHERE ${inTeam(scoutingForms, c.get("teamId"))}) AS f ON f.id = s.form_id
      WHERE f.form_kind = 'scouting' AND s.submitted_by = ${c.get("userId")}
        AND s.event_key = ${eventKey} AND s.match_number = ${matchNumber} AND s.archived_at IS NULL
      LIMIT 1`,
  );
  if (submitted) return submitted.team_name;

  if (!teams.length) return null;
  const assignedCounts = await all<{ team_number: string; assignment_count: number }>(
    dbOf(c),
    sql`SELECT team_number, COUNT(*) AS assignment_count
       FROM (SELECT * FROM ${scoutingMatchAssignments} WHERE ${inTeam(scoutingMatchAssignments, c.get("teamId"))}) AS scoped_scouting_match_assignments
      WHERE event_key = ${eventKey} AND match_number = ${matchNumber}
      GROUP BY team_number`,
  );
  const counts = new Map(
    assignedCounts.results.map((row) => [row.team_number, Number(row.assignment_count)]),
  );
  const team = teams.reduce((best, candidate) =>
    (counts.get(candidate) ?? 0) < (counts.get(best) ?? 0) ? candidate : best,
  );
  await dbOf(c)
    .insert(scoutingMatchAssignments)
    .values(
      withTeam(c.get("teamId"), {
        event_key: eventKey,
        match_number: matchNumber,
        user_id: c.get("userId"),
        team_number: team,
        assigned_at: Date.now(),
      }),
    )
    .onConflictDoNothing()
    .run();
  return (
    (
      await first<{ team_number: string }>(
        dbOf(c),
        sql`SELECT team_number FROM (SELECT * FROM ${scoutingMatchAssignments} WHERE ${inTeam(scoutingMatchAssignments, c.get("teamId"))}) AS scoped_scouting_match_assignments WHERE event_key = ${eventKey} AND match_number = ${matchNumber} AND user_id = ${c.get("userId")}`,
      )
    )?.team_number ?? null
  );
}

async function getTbaAuthKey(c: Context<AppEnv>) {
  const config = await first<{ tba_auth_key: string | null }>(
    dbOf(c),
    sql`SELECT tba_auth_key FROM (SELECT * FROM ${strategyEventConfig} WHERE ${inTeam(strategyEventConfig, c.get("teamId"))}) AS scoped_strategy_event_config WHERE id = 1`,
  );
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
  const cached = await first<{ matches_json: string }>(
    dbOf(c),
    sql`SELECT matches_json FROM tba_match_cache WHERE event_key = ${eventKey} AND expires_at > ${now}`,
  );
  if (cached) return parseJson<TbaMatch[]>(cached.matches_json, []);
  const tbaAuthKey = await getTbaAuthKey(c);
  if (!tbaAuthKey) throw new Error("TBA authentication key is not configured.");
  const response = await fetch(
    `https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(eventKey)}/matches`,
    { headers: { "X-TBA-Auth-Key": tbaAuthKey } },
  );
  if (!response.ok) throw new Error(`The Blue Alliance returned ${response.status}.`);
  const matches = (await response.json()) as TbaMatch[];
  await dbOf(c)
    .insert(tbaMatchCache)
    .values({
      event_key: eventKey,
      matches_json: JSON.stringify(matches),
      expires_at: now + 30_000,
    })
    .onConflictDoUpdate({
      target: [tbaMatchCache.event_key],
      set: { matches_json: sql`excluded.matches_json`, expires_at: sql`excluded.expires_at` },
    })
    .run();
  return matches;
}

async function getEventMatches(c: Context<AppEnv>, eventKey: string, mode?: string) {
  let scheduleMode = mode;
  if (!scheduleMode) {
    const config = await first<{ schedule_mode: string }>(
      dbOf(c),
      sql`SELECT schedule_mode FROM (SELECT * FROM ${strategyEventConfig} WHERE ${inTeam(strategyEventConfig, c.get("teamId"))}) AS scoped_strategy_event_config WHERE id = 1`,
    );
    scheduleMode = config?.schedule_mode;
  }
  return scheduleMode === "manual" ? getManualMatches(c, eventKey) : getTbaMatches(c, eventKey);
}

async function getTbaTeams(c: Context<AppEnv>, eventKey: string) {
  const now = Date.now();
  const cached = await first<{ teams_json: string }>(
    dbOf(c),
    sql`SELECT teams_json FROM tba_team_cache WHERE event_key = ${eventKey} AND expires_at > ${now}`,
  );
  if (cached) return parseJson<TbaTeam[]>(cached.teams_json, []);
  const tbaAuthKey = await getTbaAuthKey(c);
  if (!tbaAuthKey) throw new Error("TBA authentication key is not configured.");
  const response = await fetch(
    `https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(eventKey)}/teams/simple`,
    { headers: { "X-TBA-Auth-Key": tbaAuthKey } },
  );
  if (!response.ok) throw new Error(`The Blue Alliance returned ${response.status}.`);
  const teams = (await response.json()) as TbaTeam[];
  await dbOf(c)
    .insert(tbaTeamCache)
    .values({ event_key: eventKey, teams_json: JSON.stringify(teams), expires_at: now + 3_600_000 })
    .onConflictDoUpdate({
      target: [tbaTeamCache.event_key],
      set: { teams_json: sql`excluded.teams_json`, expires_at: sql`excluded.expires_at` },
    })
    .run();
  return teams;
}

app.get("/teams/search", requireAuth, async (c) => {
  const query = text(c.req.query("q"), 80).toLowerCase();
  if (!query) return c.json({ teams: [], message: null });
  const config = await first<{ event_key: string; schedule_mode: string }>(
    dbOf(c),
    sql`SELECT event_key, schedule_mode FROM (SELECT * FROM ${strategyEventConfig} WHERE ${inTeam(strategyEventConfig, c.get("teamId"))}) AS scoped_strategy_event_config WHERE id = 1`,
  );
  if (!config?.event_key)
    return c.json({ teams: [], message: "Set the TBA event key in Scouting Forms first." });
  try {
    const sourceTeams =
      config.schedule_mode === "manual"
        ? (
            await all<{ team_number: string; team_name: string }>(
              dbOf(c),
              sql`SELECT team_number, team_name FROM (SELECT * FROM ${manualTeams} WHERE ${inTeam(manualTeams, c.get("teamId"))}) AS scoped_manual_teams WHERE event_key = ${config.event_key}`,
            )
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
  const config = await first<{
    event_key: string;
    current_match_number: number | null;
    tba_auth_key: string | null;
    schedule_mode: string;
  }>(
    dbOf(c),
    sql`SELECT event_key, current_match_number, tba_auth_key, schedule_mode FROM (SELECT * FROM ${strategyEventConfig} WHERE ${inTeam(strategyEventConfig, c.get("teamId"))}) AS scoped_strategy_event_config WHERE id = 1`,
  );
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
  const config = await first<{
    event_key: string;
    current_match_number: number | null;
    tba_auth_key: string | null;
    nexus_event_key: string | null;
    nexus_api_key: string | null;
    schedule_mode: string;
  }>(
    dbOf(c),
    sql`SELECT event_key, current_match_number, tba_auth_key, nexus_event_key, nexus_api_key, schedule_mode FROM (SELECT * FROM ${strategyEventConfig} WHERE ${inTeam(strategyEventConfig, c.get("teamId"))}) AS scoped_strategy_event_config WHERE id = 1`,
  );
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
    ? await all<Record<string, unknown>>(
        dbOf(c),
        sql`SELECT user_id, display_name, last_seen_at FROM (SELECT * FROM ${strategyPresence} WHERE ${inTeam(strategyPresence, c.get("teamId"))}) AS scoped_strategy_presence WHERE is_admin = 1 AND last_seen_at >= ${now - 90_000} ORDER BY display_name`,
      )
    : null;
  const currentMatchNumber = current?.match_number ?? config?.current_match_number ?? null;
  const eventMatchSubmissions = eventKey
    ? await all<Record<string, unknown>>(
        dbOf(c),
        sql`SELECT s.id, s.submitted_by, s.submitted_by_name, s.team_name, s.created_at,
                  s.match_number, s.match_key
           FROM (SELECT * FROM ${scoutingFormSubmissions} WHERE ${inTeam(scoutingFormSubmissions, c.get("teamId"))}) AS s
           JOIN (SELECT * FROM ${scoutingForms} WHERE ${inTeam(scoutingForms, c.get("teamId"))}) AS f ON f.id = s.form_id
           WHERE f.form_kind = 'scouting' AND s.event_key = ${eventKey}
             AND s.archived_at IS NULL
           ORDER BY s.match_number, s.created_at`,
      )
    : null;
  const currentMatchSubmissions = (eventMatchSubmissions?.results ?? []).filter(
    (row) => Number(row.match_number) === currentMatchNumber,
  );
  const submittedUserIds = new Set(currentMatchSubmissions.map((row) => String(row.submitted_by)));
  const onlineScouts = current
    ? await all<Record<string, unknown>>(
        dbOf(c),
        sql`SELECT user_id, display_name, last_seen_at
         FROM (SELECT * FROM ${strategyPresence} WHERE ${inTeam(strategyPresence, c.get("teamId"))}) AS scoped_strategy_presence
         WHERE current_page = 'forms' AND last_seen_at >= ${now - 75_000}
         ORDER BY user_id`,
      )
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
        ? await first<Record<string, unknown>>(
            dbOf(c),
            sql`SELECT event_name, ends_at, delete_after FROM (SELECT * FROM ${manualEvents} WHERE ${inTeam(manualEvents, c.get("teamId"))}) AS scoped_manual_events WHERE event_key = ${eventKey}`,
          )
        : null,
    manualTeamNames:
      admin && config?.schedule_mode === "manual"
        ? Object.fromEntries(
            (
              await all<{ team_number: string; team_name: string }>(
                dbOf(c),
                sql`SELECT team_number, team_name FROM (SELECT * FROM ${manualTeams} WHERE ${inTeam(manualTeams, c.get("teamId"))}) AS scoped_manual_teams WHERE event_key = ${eventKey} ORDER BY CAST(team_number AS INTEGER)`,
              )
            ).results.map((team) => [team.team_number, team.team_name]),
          )
        : {},
  });
});

app.put("/event-context", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const activeConfig = await first<{
    event_key: string;
    tba_auth_key: string | null;
    schedule_mode: string;
  }>(
    dbOf(c),
    sql`SELECT event_key, tba_auth_key, schedule_mode FROM (SELECT * FROM ${strategyEventConfig} WHERE ${inTeam(strategyEventConfig, c.get("teamId"))}) AS scoped_strategy_event_config WHERE id = 1`,
  );
  const eventKey =
    activeConfig?.schedule_mode === "manual"
      ? activeConfig.event_key
      : text(body.eventKey, 30).toLowerCase();
  const tbaAuthKey = text(body.tbaAuthKey, 200);
  const nexusEventKey = text(body.nexusEventKey, 30).toLowerCase() || eventKey;
  const nexusApiKey = text(body.nexusApiKey, 300);
  if ((tbaAuthKey || nexusApiKey) && !c.get("userIsAdmin"))
    return c.json({ error: "Only a team trusted student can update API keys." }, 403);
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
  const updateConfig = dbOf(c)
    .insert(strategyEventConfig)
    .values(
      withTeam(c.get("teamId"), {
        id: 1,
        event_key: eventKey,
        current_match_number: currentMatchNumber,
        tba_auth_key: sql`NULLIF(${tbaAuthKey}, '')`,
        nexus_event_key: nexusEventKey,
        nexus_api_key: sql`NULLIF(${nexusApiKey}, '')`,
        updated_by: c.get("userId"),
        updated_at: Date.now(),
      }),
    )
    .onConflictDoUpdate({
      target: [strategyEventConfig.teamId, strategyEventConfig.id],
      set: {
        event_key: sql`excluded.event_key`,
        current_match_number: sql`excluded.current_match_number`,
        tba_auth_key: sql`CASE WHEN excluded.tba_auth_key IS NULL THEN ${strategyEventConfig.tba_auth_key} ELSE excluded.tba_auth_key END`,
        nexus_event_key: sql`excluded.nexus_event_key`,
        nexus_api_key: sql`CASE WHEN excluded.nexus_api_key IS NULL THEN ${strategyEventConfig.nexus_api_key} ELSE excluded.nexus_api_key END`,
        updated_by: sql`excluded.updated_by`,
        updated_at: sql`excluded.updated_at`,
      },
    });
  if (tbaConfigChanged) {
    await batch(dbOf(c), [
      updateConfig,
      dbOf(c).delete(tbaMatchCache).where(sql`event_key = ${eventKey}`),
      dbOf(c).delete(tbaTeamCache).where(sql`event_key = ${eventKey}`),
    ]);
  } else {
    await updateConfig.run();
  }
  return c.json({ ok: true });
});

app.get("/announcements/active", requireAuth, async (c) => {
  const rows = await all<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT id, message, created_by_name, created_at, expires_at
     FROM (SELECT * FROM ${strategyAnnouncements} WHERE ${inTeam(strategyAnnouncements, c.get("teamId"))}) AS scoped_strategy_announcements
     WHERE expires_at > ${Date.now()}
     ORDER BY created_at DESC
     LIMIT 5`,
  );
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
  await dbOf(c)
    .insert(strategyPresence)
    .values(
      withTeam(c.get("teamId"), {
        user_id: c.get("userId"),
        display_name: c.get("userDisplayName"),
        is_admin: (await isStrategyAdmin(c)) ? 1 : 0,
        last_seen_at: Date.now(),
        current_page: currentPage,
      }),
    )
    .onConflictDoUpdate({
      target: [strategyPresence.teamId, strategyPresence.user_id],
      set: {
        display_name: sql`excluded.display_name`,
        is_admin: sql`excluded.is_admin`,
        last_seen_at: sql`excluded.last_seen_at`,
        current_page: sql`excluded.current_page`,
      },
    })
    .run();
  return c.json({ ok: true });
});

app.get("/presence", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const rows = await all<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT user_id, display_name, is_admin, last_seen_at, current_page
     FROM (SELECT * FROM ${strategyPresence} WHERE ${inTeam(strategyPresence, c.get("teamId"))}) AS scoped_strategy_presence
     WHERE last_seen_at >= ${Date.now() - 75_000}
     ORDER BY is_admin DESC, display_name`,
  );
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
  await dbOf(c)
    .insert(strategyAnnouncements)
    .values(
      withTeam(c.get("teamId"), {
        id: announcementId,
        message: message,
        created_by: c.get("userId"),
        created_by_name: c.get("userDisplayName"),
        created_at: now,
        expires_at: now + durationSeconds * 1000,
      }),
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

app.route("/", engagementRoutes);
app.route("/", predictionsRoutes);
app.route("/", manualRoutes);

app.get("/scouting-forms", requireAuth, async (c) => {
  await seedTeam(dbOf(c), c.get("teamId"));
  const rows = await all<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT * FROM (SELECT * FROM ${scoutingForms} WHERE ${inTeam(scoutingForms, c.get("teamId"))}) AS scoped_scouting_forms WHERE form_kind IN ('scouting', 'pit') ORDER BY form_kind DESC`,
  );
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
  await dbOf(c)
    .insert(scoutingForms)
    .values(
      withTeam(c.get("teamId"), {
        id: formId,
        name: name,
        description: text(body.description, 1000),
        fields_json: JSON.stringify(fields),
        is_active: 1,
        created_by: c.get("userId"),
        created_at: now,
        updated_at: now,
      }),
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
  await dbOf(c)
    .update(scoutingForms)
    .set({
      name: name,
      description: text(body.description, 1000),
      fields_json: JSON.stringify(fields),
      is_active: 1,
      updated_at: Date.now(),
    })
    .where(inTeam(scoutingForms, c.get("teamId"), sql`id = ${c.req.param("id")}`))
    .run();
  return c.json({ ok: true });
});

app.delete("/scouting-forms/:id", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  await dbOf(c)
    .update(scoutingForms)
    .set({ is_active: 0 })
    .where(inTeam(scoutingForms, c.get("teamId"), sql`id = ${c.req.param("id")}`))
    .run();
  return c.json({ ok: true });
});

app.post("/scouting-forms/:id/submissions", requireAuth, async (c) => {
  const formDefinition = await first<{ fields_json: string; form_kind: string }>(
    dbOf(c),
    sql`SELECT fields_json, form_kind FROM (SELECT * FROM ${scoutingForms} WHERE ${inTeam(scoutingForms, c.get("teamId"))}) AS scoped_scouting_forms WHERE id = ${c.req.param("id")} AND is_active = 1`,
  );
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
    const existing = await first<Record<string, unknown>>(
      dbOf(c),
      sql`SELECT s.id
       FROM (SELECT * FROM ${scoutingFormSubmissions} WHERE ${inTeam(scoutingFormSubmissions, c.get("teamId"))}) AS s
       JOIN (SELECT * FROM ${scoutingForms} WHERE ${inTeam(scoutingForms, c.get("teamId"))}) AS f ON f.id = s.form_id
       WHERE f.form_kind = 'scouting' AND s.submitted_by = ${c.get("userId")}
         AND s.event_key = ${eventLink.eventKey} AND s.match_number = ${eventLink.matchNumber}
       LIMIT 1`,
    );
    if (existing)
      return c.json({ error: "You already submitted a scouting form for this match." }, 409);
    const assignment = await first<{ team_number: string }>(
      dbOf(c),
      sql`SELECT team_number FROM (SELECT * FROM ${scoutingMatchAssignments} WHERE ${inTeam(scoutingMatchAssignments, c.get("teamId"))}) AS scoped_scouting_match_assignments WHERE event_key = ${eventLink.eventKey} AND match_number = ${eventLink.matchNumber} AND user_id = ${c.get("userId")}`,
    );
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
    drawingKey = `teams/${encodeURIComponent(c.get("teamId"))}/scouting-submissions/${submissionId}.png`;
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
    const key = `teams/${encodeURIComponent(c.get("teamId"))}/scouting-submissions/${submissionId}/${field.id}.png`;
    await c.env.FIELD_MAPS.put(key, await fieldDrawing.arrayBuffer(), {
      httpMetadata: { contentType: fieldDrawing.type },
    });
    drawingFields[field.id] = { key, contentType: fieldDrawing.type };
  }
  const submittedAt = Date.now();
  const submissionStatement = dbOf(c)
    .insert(scoutingFormSubmissions)
    .values(
      withTeam(c.get("teamId"), {
        id: submissionId,
        form_id: c.req.param("id"),
        fields_json: formDefinition.fields_json,
        answers_json: JSON.stringify(cleanAnswers),
        drawing_r2_key: drawingKey,
        drawing_content_type: drawingType,
        submitted_by: c.get("userId"),
        submitted_by_name: c.get("userDisplayName"),
        created_at: submittedAt,
        team_name: teamName,
        drawing_fields_json: JSON.stringify(drawingFields),
        event_key: eventLink.eventKey,
        match_key: eventLink.matchKey,
        match_number: eventLink.matchNumber,
      }),
    );
  let boyleBucksAwarded = 0;
  try {
    if (
      formDefinition.form_kind === "scouting" &&
      (await getEngagementSettings(c.env.SCOUTING_DB, c.get("teamId"))).enabled
    ) {
      const rewardReference = `submission:${submissionId}`;
      await batch(dbOf(c), [
        submissionStatement,
        dbOf(c)
          .insert(boylebucksAccounts)
          .values(
            withTeam(c.get("teamId"), {
              user_id: c.get("userId"),
              display_name: c.get("userDisplayName"),
              balance: 0,
              earned: 0,
              wagered: 0,
              updated_at: submittedAt,
            }),
          )
          .onConflictDoUpdate({
            target: [boylebucksAccounts.teamId, boylebucksAccounts.user_id],
            set: { display_name: sql`excluded.display_name` },
          }),
        dbOf(c)
          .update(boylebucksAccounts)
          .set({ balance: sql`balance + 10`, earned: sql`earned + 10`, updated_at: submittedAt })
          .where(
            inTeam(
              boylebucksAccounts,
              c.get("teamId"),
              sql`user_id = ${c.get("userId")}
              AND NOT EXISTS (SELECT 1 FROM (SELECT * FROM ${boylebucksLedger} WHERE ${inTeam(boylebucksLedger, c.get("teamId"))}) AS scoped_boylebucks_ledger WHERE reference_id = ${rewardReference})`,
            ),
          ),
        dbOf(c)
          .insert(boylebucksLedger)
          .values(
            withTeam(c.get("teamId"), {
              id: id("ledger"),
              user_id: c.get("userId"),
              amount: 10,
              reason: "Valid scouting form",
              reference_id: rewardReference,
              created_at: submittedAt,
            }),
          )
          .onConflictDoNothing(),
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
  const rows = await all<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT * FROM (SELECT * FROM ${scoutingFormSubmissions} WHERE ${inTeam(scoutingFormSubmissions, c.get("teamId"))}) AS scoped_scouting_form_submissions WHERE form_id = ${c.req.param("id")} ORDER BY created_at DESC`,
  );
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
  const row = await first<{ drawing_r2_key: string | null; drawing_content_type: string | null }>(
    dbOf(c),
    sql`SELECT drawing_r2_key, drawing_content_type FROM (SELECT * FROM ${scoutingFormSubmissions} WHERE ${inTeam(scoutingFormSubmissions, c.get("teamId"))}) AS scoped_scouting_form_submissions WHERE id = ${c.req.param("id")}`,
  );
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
  const row = await first<{ drawing_fields_json: string }>(
    dbOf(c),
    sql`SELECT drawing_fields_json FROM (SELECT * FROM ${scoutingFormSubmissions} WHERE ${inTeam(scoutingFormSubmissions, c.get("teamId"))}) AS scoped_scouting_form_submissions WHERE id = ${c.req.param("id")}`,
  );
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
  const rows = await all<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT * FROM (SELECT * FROM ${tierLists} WHERE ${inTeam(tierLists, c.get("teamId"))}) AS scoped_tier_lists ORDER BY updated_at DESC`,
  );
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
  await dbOf(c)
    .insert(tierLists)
    .values(
      withTeam(c.get("teamId"), {
        id: recordId,
        name: name,
        description: text(body.description, 500),
        tiers_json: JSON.stringify(tiers),
        created_by: c.get("userId"),
        created_at: now,
        updated_at: now,
      }),
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
  await dbOf(c)
    .update(tierLists)
    .set({
      name: name,
      description: text(body.description, 500),
      tiers_json: JSON.stringify(body.tiers),
      updated_at: Date.now(),
    })
    .where(inTeam(tierLists, c.get("teamId"), sql`id = ${c.req.param("id")}`))
    .run();
  return c.json({ ok: true });
});

app.delete("/tier-lists/:id", requireAuth, async (c) => {
  await dbOf(c)
    .delete(tierLists)
    .where(inTeam(tierLists, c.get("teamId"), sql`id = ${c.req.param("id")}`))
    .run();
  return c.json({ ok: true });
});

app.get("/field-maps", requireAuth, async (c) => {
  const rows = await all<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT * FROM (SELECT * FROM ${fieldMaps} WHERE ${inTeam(fieldMaps, c.get("teamId"))}) AS scoped_field_maps ORDER BY updated_at DESC`,
  );
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
  const permission = await first<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT email FROM (SELECT * FROM ${fieldMapPublishers} WHERE ${inTeam(fieldMapPublishers, c.get("teamId"))}) AS scoped_field_map_publishers WHERE email = ${c.get("userEmail").toLowerCase()}`,
  );
  return Boolean(permission);
}

app.get("/field-map-permissions", requireAuth, async (c) =>
  c.json({ canShare: await canShareFieldMaps(c), isAdmin: c.get("userIsAdmin") }),
);

app.get("/field-map-publishers", requireAuth, async (c) => {
  if (!c.get("userIsIdentityAdmin"))
    return c.json({ error: "Only ID's trusted students can assign permissions." }, 403);
  const rows = await all<{ email: string; created_at: number }>(
    dbOf(c),
    sql`SELECT email, created_at FROM (SELECT * FROM ${fieldMapPublishers} WHERE ${inTeam(fieldMapPublishers, c.get("teamId"))}) AS scoped_field_map_publishers ORDER BY email`,
  );
  return c.json({ publishers: rows.results });
});

app.get("/permission-management", requireAuth, async (c) => {
  if (!c.get("userIsIdentityAdmin"))
    return c.json({ error: "Only ID's trusted students can assign permissions." }, 403);
  const db = dbOf(c);
  const [leads, publishers, helpers] = await Promise.all([
    db
      .select({ userId: strategyAdmins.user_id })
      .from(strategyAdmins)
      .where(inTeam(strategyAdmins, c.get("teamId")))
      .all(),
    db
      .select({ email: fieldMapPublishers.email })
      .from(fieldMapPublishers)
      .where(inTeam(fieldMapPublishers, c.get("teamId")))
      .all(),
    db
      .select({ userId: serviceHelpers.user_id, skills: serviceHelpers.skills_json })
      .from(serviceHelpers)
      .where(inTeam(serviceHelpers, c.get("teamId")))
      .all(),
  ]);
  return c.json({ leads, publishers, helpers });
});

app.get("/strategy-admins", requireAuth, async (c) => {
  if (!c.get("userIsIdentityAdmin"))
    return c.json({ error: "Strategy lead access required." }, 403);
  const admins = await all<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT user_id, email, display_name, created_at FROM (SELECT * FROM ${strategyAdmins} WHERE ${inTeam(strategyAdmins, c.get("teamId"))}) AS scoped_strategy_admins ORDER BY display_name`,
  );
  const users = c.get("userIsIdentityAdmin") ? await getG3IdUsers(c) : null;
  return c.json({
    admins: admins.results,
    users: users ?? [],
    canManage: c.get("userIsIdentityAdmin"),
  });
});

app.post("/strategy-admins", requireAuth, async (c) => {
  if (!c.get("userIsIdentityAdmin"))
    return c.json({ error: "Only ID's trusted students can assign permissions." }, 403);
  const body = await c.req.json<{ userId?: unknown }>();
  const userId = text(body.userId, 200);
  const users = await getG3IdUsers(c);
  const user = users?.find((candidate) => candidate.id === userId && candidate.status === "active");
  if (!user) return c.json({ error: "Select an active account." }, 400);
  await dbOf(c)
    .insert(strategyAdmins)
    .values(
      withTeam(c.get("teamId"), {
        user_id: user.id,
        email: user.email.toLowerCase(),
        display_name: user.displayName,
        granted_by: c.get("userId"),
        created_at: Date.now(),
      }),
    )
    .onConflictDoUpdate({
      target: [strategyAdmins.teamId, strategyAdmins.user_id],
      set: {
        email: sql`excluded.email`,
        display_name: sql`excluded.display_name`,
        granted_by: sql`excluded.granted_by`,
        created_at: sql`excluded.created_at`,
      },
    })
    .run();
  return c.json({ ok: true }, 201);
});

app.delete("/strategy-admins/:userId", requireAuth, async (c) => {
  if (!c.get("userIsIdentityAdmin"))
    return c.json({ error: "Only ID's trusted students can assign permissions." }, 403);
  await dbOf(c)
    .delete(strategyAdmins)
    .where(inTeam(strategyAdmins, c.get("teamId"), sql`user_id = ${c.req.param("userId")}`))
    .run();
  return c.json({ ok: true });
});

app.get("/analysis", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const team = teamNumber(c.req.query("team"));
  const teamB = teamNumber(c.req.query("teamB"));
  const includeArchived = c.req.query("archived") === "true";
  const reportFilter = team
    ? teamB
      ? sql`s.team_name IN (${team}, ${teamB})`
      : sql`s.team_name = ${team}`
    : sql`1 = 1`;
  const commentFilter = team
    ? teamB
      ? sql`team_name IN (${team}, ${teamB})`
      : sql`team_name = ${team}`
    : sql`1 = 1`;
  const [rows, teamComments, eventConfig] = await Promise.all([
    all<Record<string, unknown>>(
      dbOf(c),
      sql`SELECT s.*, f.name AS form_name, f.form_kind,
      COALESCE(s.fields_json, f.fields_json) AS fields_json
      FROM (SELECT * FROM ${scoutingFormSubmissions} WHERE ${inTeam(scoutingFormSubmissions, c.get("teamId"))}) s
      JOIN (SELECT * FROM ${scoutingForms} WHERE ${inTeam(scoutingForms, c.get("teamId"))}) f ON f.id = s.form_id
      WHERE ${reportFilter} ${includeArchived ? sql`` : sql`AND s.archived_at IS NULL`}
      ORDER BY CASE WHEN s.starred_fields_json = '[]' THEN 1 ELSE 0 END, s.created_at DESC`,
    ),
    all<Record<string, unknown>>(
      dbOf(c),
      sql`SELECT * FROM ${teamCommentsTable} WHERE ${inTeam(teamCommentsTable, c.get("teamId"), commentFilter)} ORDER BY created_at DESC`,
    ),
    first<{
      event_key: string;
    }>(
      dbOf(c),
      sql`SELECT event_key FROM (SELECT * FROM ${strategyEventConfig} WHERE ${inTeam(strategyEventConfig, c.get("teamId"))}) AS scoped_strategy_event_config WHERE id = 1`,
    ),
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
  const report = await first<{ starred_fields_json: string; fields_json: string }>(
    dbOf(c),
    sql`SELECT s.starred_fields_json, f.fields_json
     FROM (SELECT * FROM ${scoutingFormSubmissions} WHERE ${inTeam(scoutingFormSubmissions, c.get("teamId"))}) AS s
     JOIN (SELECT * FROM ${scoutingForms} WHERE ${inTeam(scoutingForms, c.get("teamId"))}) AS f ON f.id = s.form_id
     WHERE s.id = ${c.req.param("id")}`,
  );
  if (!report) return c.json({ error: "Report not found." }, 404);
  const validFieldIds = new Set([
    "__report",
    ...parseJson<ScoutingField[]>(report.fields_json, []).map((field) => field.id),
  ]);
  if (!validFieldIds.has(fieldId)) return c.json({ error: "That answer no longer exists." }, 400);
  const starred = new Set(parseJson<string[]>(report.starred_fields_json, []));
  if (body.starred === true) starred.add(fieldId);
  else starred.delete(fieldId);
  await dbOf(c)
    .update(scoutingFormSubmissions)
    .set({ starred_fields_json: JSON.stringify(Array.from(starred)) })
    .where(inTeam(scoutingFormSubmissions, c.get("teamId"), sql`id = ${c.req.param("id")}`))
    .run();
  return c.json({ starredFieldIds: Array.from(starred) });
});

app.delete("/analysis/reports/:id", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const body: { reason?: unknown } = await c.req.json<{ reason?: unknown }>().catch(() => ({}));
  const result = await dbOf(c)
    .update(scoutingFormSubmissions)
    .set({
      archived_at: Date.now(),
      archived_by: c.get("userId"),
      archive_reason: text(body.reason, 500),
    })
    .where(
      inTeam(
        scoutingFormSubmissions,
        c.get("teamId"),
        sql`id = ${c.req.param("id")} AND archived_at IS NULL`,
      ),
    )
    .run();
  if (!result.meta.changes) return c.json({ error: "Active report not found." }, 404);
  return c.json({ ok: true });
});

app.put("/analysis/reports/:id/restore", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const result = await dbOf(c)
    .update(scoutingFormSubmissions)
    .set({ archived_at: null, archived_by: null, archive_reason: null })
    .where(
      inTeam(
        scoutingFormSubmissions,
        c.get("teamId"),
        sql`id = ${c.req.param("id")} AND archived_at IS NOT NULL`,
      ),
    )
    .run();
  if (!result.meta.changes) return c.json({ error: "Archived report not found." }, 404);
  return c.json({ ok: true });
});

app.delete("/analysis/reports/:id/permanent", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const report = await first<{ drawing_r2_key: string | null; drawing_fields_json: string }>(
    dbOf(c),
    sql`SELECT drawing_r2_key, drawing_fields_json FROM (SELECT * FROM ${scoutingFormSubmissions} WHERE ${inTeam(scoutingFormSubmissions, c.get("teamId"))}) AS scoped_scouting_form_submissions WHERE id = ${c.req.param("id")}`,
  );
  if (!report) return c.json({ error: "Report not found." }, 404);
  const fieldDrawings = Object.values(
    parseJson<Record<string, { key: string }>>(report.drawing_fields_json, {}),
  );
  await Promise.all([
    ...fieldDrawings.map((drawing) => c.env.FIELD_MAPS.delete(drawing.key)),
    ...(report.drawing_r2_key ? [c.env.FIELD_MAPS.delete(report.drawing_r2_key)] : []),
  ]);
  await dbOf(c)
    .delete(scoutingFormSubmissions)
    .where(inTeam(scoutingFormSubmissions, c.get("teamId"), sql`id = ${c.req.param("id")}`))
    .run();
  return c.json({ ok: true });
});

app.get("/field-map-publisher-options", requireAuth, async (c) => {
  if (!c.get("userIsIdentityAdmin"))
    return c.json({ error: "Only ID's trusted students can assign permissions." }, 403);
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
  if (!c.get("userIsIdentityAdmin"))
    return c.json({ error: "Only ID's trusted students can assign permissions." }, 403);
  const body = await c.req.json<{ userId?: unknown }>();
  const userId = text(body.userId, 200);
  if (!userId) return c.json({ error: "Select an account." }, 400);
  const users = await getG3IdUsers(c);
  if (!users) return c.json({ error: "Could not check that account." }, 502);
  const user = users.find((candidate) => candidate.id === userId && candidate.status === "active");
  if (!user) return c.json({ error: "Select an active account." }, 400);
  const email = user.email.toLowerCase();
  await dbOf(c)
    .insert(fieldMapPublishers)
    .values(
      withTeam(c.get("teamId"), {
        email: email,
        granted_by: c.get("userId"),
        created_at: Date.now(),
      }),
    )
    .onConflictDoNothing()
    .run();
  return c.json({ ok: true }, 201);
});

app.delete("/field-map-publishers/:email", requireAuth, async (c) => {
  if (!c.get("userIsIdentityAdmin"))
    return c.json({ error: "Only ID's trusted students can assign permissions." }, 403);
  await dbOf(c)
    .delete(fieldMapPublishers)
    .where(
      inTeam(
        fieldMapPublishers,
        c.get("teamId"),
        sql`email = ${decodeURIComponent(c.req.param("email")).toLowerCase()}`,
      ),
    )
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
  const key = `teams/${encodeURIComponent(c.get("teamId"))}/field-maps/${recordId}.${extension}`;
  await c.env.FIELD_MAPS.put(key, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type },
  });
  const now = Date.now();
  await dbOf(c)
    .insert(fieldMaps)
    .values(
      withTeam(c.get("teamId"), {
        id: recordId,
        name: name,
        event_name: text(form.get("eventName"), 120),
        notes: text(form.get("notes"), 2000),
        r2_key: key,
        content_type: image.type,
        created_by: c.get("userId"),
        created_at: now,
        updated_at: now,
      }),
    )
    .run();
  return c.json({ id: recordId }, 201);
});

app.get("/field-maps/:id/image", requireAuth, async (c) => {
  const map = await first<{ r2_key: string; content_type: string }>(
    dbOf(c),
    sql`SELECT r2_key, content_type FROM (SELECT * FROM ${fieldMaps} WHERE ${inTeam(fieldMaps, c.get("teamId"))}) AS scoped_field_maps WHERE id = ${c.req.param("id")}`,
  );
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
  const map = await first<{ r2_key: string; created_by: string }>(
    dbOf(c),
    sql`SELECT r2_key, created_by FROM (SELECT * FROM ${fieldMaps} WHERE ${inTeam(fieldMaps, c.get("teamId"))}) AS scoped_field_maps WHERE id = ${c.req.param("id")}`,
  );
  if (!map) return c.json({ error: "Map not found." }, 404);
  if (!c.get("userIsAdmin") && map.created_by !== c.get("userId")) {
    return c.json({ error: "Only the publisher or a trusted student can delete this map." }, 403);
  }
  await Promise.all([
    c.env.FIELD_MAPS.delete(map.r2_key),
    dbOf(c)
      .delete(fieldMaps)
      .where(inTeam(fieldMaps, c.get("teamId"), sql`id = ${c.req.param("id")}`))
      .run(),
  ]);
  return c.json({ ok: true });
});

app.get("/autos", requireAuth, async (c) => {
  const rows = await all<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT * FROM (SELECT * FROM ${autoRoutines} WHERE ${inTeam(autoRoutines, c.get("teamId"))}) AS scoped_auto_routines ORDER BY updated_at DESC`,
  );
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
    imageKey = `teams/${encodeURIComponent(c.get("teamId"))}/auto-images/${recordId}.${extension}`;
    imageContentType = image.type;
    await c.env.FIELD_MAPS.put(imageKey, await image.arrayBuffer(), {
      httpMetadata: { contentType: image.type },
    });
  }

  const steps = parseJson<unknown>(form.get("steps"), []);
  await dbOf(c)
    .insert(autoRoutines)
    .values(
      withTeam(c.get("teamId"), {
        id: recordId,
        name: name,
        robot_name: autoTeam,
        start_position: "",
        summary: text(form.get("description"), 2000),
        steps_json: JSON.stringify(stringArray(steps)),
        tags_json: "[]",
        image_r2_key: imageKey,
        image_content_type: imageContentType,
        created_by: c.get("userId"),
        created_at: now,
        updated_at: now,
      }),
    )
    .run();
  return c.json({ id: recordId }, 201);
});

app.get("/autos/:id/image", requireAuth, async (c) => {
  const auto = await first<{ image_r2_key: string | null; image_content_type: string | null }>(
    dbOf(c),
    sql`SELECT image_r2_key, image_content_type FROM (SELECT * FROM ${autoRoutines} WHERE ${inTeam(autoRoutines, c.get("teamId"))}) AS scoped_auto_routines WHERE id = ${c.req.param("id")}`,
  );
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
  const auto = await first<{ image_r2_key: string | null }>(
    dbOf(c),
    sql`SELECT image_r2_key FROM (SELECT * FROM ${autoRoutines} WHERE ${inTeam(autoRoutines, c.get("teamId"))}) AS scoped_auto_routines WHERE id = ${c.req.param("id")}`,
  );
  if (auto?.image_r2_key) await c.env.FIELD_MAPS.delete(auto.image_r2_key);
  await dbOf(c)
    .delete(autoRoutines)
    .where(inTeam(autoRoutines, c.get("teamId"), sql`id = ${c.req.param("id")}`))
    .run();
  return c.json({ ok: true });
});

// Robot Library was retired. Keep its old tables untouched so existing data is not
// destructively deleted, but do not expose the legacy API surface.
app.all("/robots", (c) => c.json({ error: "Not found." }, 404));
app.all("/robots/*", (c) => c.json({ error: "Not found." }, 404));

app.get("/operations", requireAuth, async (c) => {
  const admin = await isStrategyAdmin(c);
  const allowed = admin || (await isServiceHelper(c));
  if (!allowed) return c.json({ error: "Service crew access required." }, 403);
  const status = c.req.query("status") === "closed" ? "closed" : "active";
  const [rows, helpers, users] = await Promise.all([
    status === "closed"
      ? all<Record<string, unknown>>(
          dbOf(c),
          sql`SELECT * FROM (SELECT * FROM ${serviceTickets} WHERE ${inTeam(serviceTickets, c.get("teamId"))}) AS scoped_service_tickets WHERE status = 'closed' ORDER BY updated_at DESC LIMIT 500`,
        )
      : all<Record<string, unknown>>(
          dbOf(c),
          sql`SELECT * FROM (SELECT * FROM ${serviceTickets} WHERE ${inTeam(serviceTickets, c.get("teamId"))}) AS scoped_service_tickets WHERE status IN ('open', 'claimed') ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 200`,
        ),
    admin
      ? all<Record<string, unknown>>(
          dbOf(c),
          sql`SELECT * FROM (SELECT * FROM ${serviceHelpers} WHERE ${inTeam(serviceHelpers, c.get("teamId"))}) AS scoped_service_helpers ORDER BY display_name`,
        )
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
  await dbOf(c)
    .insert(serviceTickets)
    .values(
      withTeam(c.get("teamId"), {
        id: ticketId,
        team_name: teamName,
        issue_type: issueType,
        description: text(body.description, 2000),
        status: "open",
        created_by: c.get("userId"),
        created_by_name: c.get("userDisplayName"),
        created_at: now,
        updated_at: now,
        event_key: eventLink.eventKey,
        match_key: eventLink.matchKey,
        match_number: eventLink.matchNumber,
      }),
    )
    .run();
  const helpers = await dbOf(c)
    .select({ userId: serviceHelpers.user_id })
    .from(serviceHelpers)
    .where(inTeam(serviceHelpers, c.get("teamId")));
  for (let offset = 0; offset < helpers.length; offset += 100) {
    await c.env.G3ID.fetch(
      new Request(
        `http://g3id/api/internal/teams/${encodeURIComponent(c.get("teamId"))}/slack/dm-members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userIds: helpers.slice(offset, offset + 100).map((helper) => helper.userId),
            text: `New ${issueType} service ticket for team ${teamName}: ${text(body.description, 500)}\nOpen Service Tickets to claim it.`,
          }),
        },
      ),
    ).catch((error) => console.error("[scouting] service notification failed", error));
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
    const ticket = await first<{ event_key: string | null }>(
      dbOf(c),
      sql`SELECT event_key FROM (SELECT * FROM ${serviceTickets} WHERE ${inTeam(serviceTickets, c.get("teamId"))}) AS scoped_service_tickets WHERE id = ${sourceTicketId} AND team_name = ${teamName} AND status = 'closed'`,
    );
    if (!ticket) return c.json({ error: "Choose a closed ticket for this team." }, 400);
    eventKey = ticket.event_key;
  } else {
    eventKey = (await resolveEventLink(c)).eventKey || null;
  }
  const commentId = id("team_comment");
  await dbOf(c)
    .insert(teamCommentsTable)
    .values(
      withTeam(c.get("teamId"), {
        id: commentId,
        team_name: teamName,
        comment: comment,
        event_key: eventKey,
        source_ticket_id: sourceTicketId,
        created_by: c.get("userId"),
        created_by_name: c.get("userDisplayName"),
        created_at: Date.now(),
      }),
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
    await dbOf(c)
      .update(serviceTickets)
      .set({
        status: "claimed",
        claimed_by: c.get("userId"),
        claimed_by_name: c.get("userDisplayName"),
        updated_at: Date.now(),
      })
      .where(
        inTeam(serviceTickets, c.get("teamId"), sql`id = ${c.req.param("id")} AND status = 'open'`),
      )
      .run();
  else if (action === "close") {
    const resolution = text(body.resolution, 2000);
    if (!resolution) return c.json({ error: "A closure comment is required." }, 400);
    await dbOf(c)
      .update(serviceTickets)
      .set({ status: "closed", resolution: resolution, updated_at: Date.now() })
      .where(inTeam(serviceTickets, c.get("teamId"), sql`id = ${c.req.param("id")}`))
      .run();
  } else return c.json({ error: "Unknown action." }, 400);
  return c.json({ ok: true });
});

app.post("/service-helpers", requireAuth, async (c) => {
  if (!c.get("userIsIdentityAdmin"))
    return c.json({ error: "Strategy lead access required." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const users = await getG3IdUsers(c);
  const user = users?.find(
    (item) => item.id === text(body.userId, 200) && item.status === "active",
  );
  if (!user) return c.json({ error: "Select an active user." }, 400);
  await dbOf(c)
    .insert(serviceHelpers)
    .values(
      withTeam(c.get("teamId"), {
        user_id: user.id,
        display_name: user.displayName,
        email: user.email,
        slack_user_id: null,
        skills_json: JSON.stringify(stringArray(body.skills, 10)),
        approved_by: c.get("userId"),
        created_at: Date.now(),
      }),
    )
    .onConflictDoUpdate({
      target: [serviceHelpers.teamId, serviceHelpers.user_id],
      set: {
        display_name: sql`excluded.display_name`,
        email: sql`excluded.email`,
        slack_user_id: sql`excluded.slack_user_id`,
        skills_json: sql`excluded.skills_json`,
        approved_by: sql`excluded.approved_by`,
        created_at: sql`excluded.created_at`,
      },
    })
    .run();
  return c.json({ ok: true }, 201);
});

app.delete("/service-helpers/:id", requireAuth, async (c) => {
  if (!c.get("userIsIdentityAdmin"))
    return c.json({ error: "Strategy lead access required." }, 403);
  await dbOf(c)
    .delete(serviceHelpers)
    .where(inTeam(serviceHelpers, c.get("teamId"), sql`user_id = ${c.req.param("id")}`))
    .run();
  return c.json({ ok: true });
});

const worker = new Hono<AppEnv>();
worker.use("*", appAuthContext("scouting"));
worker.use("*", async (c, next) => {
  await adoptLegacyRows(c.env.SCOUTING_DB);
  await next();
});
worker
  .route("/internal", internalRoutes)
  .route("/team-settings", teamSettingsRouter)
  .route("/scouting", app);
export { worker as app };

export type ScoutingApp = typeof worker;
export default {
  fetch: withApiPrefix(worker.fetch),
  scheduled: (_event: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) => {
    ctx.waitUntil(settleConfiguredGame(env, purgeExpiredManualEvents));
  },
};
