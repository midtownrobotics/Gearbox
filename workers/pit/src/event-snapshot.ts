import { inTeam, logTeamChange, requireAdmin, withTeam } from "@g3/auth";
import { DEMO_STUDENTS } from "@g3/demo";
import { isStaging } from "@g3/site-config";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type Db, createDb } from "./db";
import { settings } from "./db/schema";
import {
  BONUS_RP,
  type MatchResult,
  type NexusStatus,
  contextRankingsFor,
  ourSchedule,
} from "./monitor-matches";
import { getSetting } from "./settings";
import gritsSnapshot from "./snapshots/2026gagr.json";
import type { AppEnv } from "./types";

// A past event for the Monitor, in dev and staging only: GRITS 2026 (2026gagr) as Qualification
// 31 went on the field, halfway through qualifications, so the Monitor has a schedule, results,
// queuing and rankings to show away from an event. An admin switches it on on Pit's Admin page
// ("Use event snapshot"); off, the Monitor asks The Blue Alliance and Nexus as usual. Production
// never offers it.
//
// The snapshot's times are kept from the moment it was taken and replayed from when it was
// switched on (the setting's value), so the countdowns run as they did; switching it off and on
// starts them again. Its clock is how long it has run since that moment: each match's Nexus status
// and score follow it, and an admin can move it on or back from the Monitor (`PUT
// /admin/event-snapshot/clock`) to see the Monitor at any point of the event. Rankings stay as
// they were. The data comes from The Blue Alliance's public pages for the event.

type Bindings = AppEnv["Bindings"];

type SnapshotMatch = {
  label: string;
  redTeams: string[];
  blueTeams: string[];
  /** When it was to start, in ms from the moment the snapshot was taken. */
  startOffsetMs: number;
  /** Its score, for the matches played by then. */
  result?: {
    red: number;
    blue: number;
    winner: string;
    /** Which bonus RPs each alliance earned, in the season's order (`BONUS_RP`). */
    bonus?: { red: boolean[]; blue: boolean[] };
  };
};

type Snapshot = {
  event: string;
  name: string;
  /** The team whose matches the Monitor follows. */
  teamNumber: string;
  source: string;
  matches: SnapshotMatch[];
  rankings: {
    rank: number;
    team: string;
    rp: number;
    wins: number;
    losses: number;
    ties: number;
  }[];
};

const snapshot = gritsSnapshot as Snapshot;

const SINCE = "eventSnapshotSince";

/** Nexus's estimates, before a match starts: queuing and going on the field. */
const QUEUE_BEFORE_MS = 18 * 60_000;
const ON_FIELD_BEFORE_MS = 5 * 60_000;
/** The two matches after the one on the field are called only this close to their start, so one
 * after a break (lunch, overnight) waits. */
const CALLED_WITHIN_MS = 30 * 60_000;
/** How long after its start a match's score is in. */
const SCORED_AFTER_MS = 5 * 60_000;
/** How far before the first match and after the last the clock can be moved. */
const CLOCK_MARGIN_MS = 60 * 60_000;

const firstStart = Math.min(...snapshot.matches.map((match) => match.startOffsetMs));
const lastStart = Math.max(...snapshot.matches.map((match) => match.startOffsetMs));

/**
 * Where Nexus would have each match (start offsets, in order) `clock` ms after the snapshot's
 * moment. Like Nexus, in order: the last match due on the field (5 minutes before its start) is on
 * it and every one before it has been; the next is On deck and the one after Now queuing.
 */
export function statusesAt(starts: number[], clock: number): NexusStatus[] {
  let onField = -1;
  starts.forEach((start, index) => {
    if (start - ON_FIELD_BEFORE_MS <= clock) onField = index;
  });
  return starts.map((start, index) => {
    if (index <= onField) return "On field";
    const called = start - clock <= CALLED_WITHIN_MS;
    if (called && index === onField + 1) return "On deck";
    if (called && index === onField + 2) return "Now queuing";
    return "Queuing soon";
  });
}

/** A played match's score as `GET /monitor/data` gives it, with its bonus RPs' names. */
function resultOf(match: SnapshotMatch): MatchResult | null {
  if (!match.result) return null;
  const { bonus, ...score } = match.result;
  const season = BONUS_RP[Number(snapshot.event.slice(0, 4))];
  return {
    ...(score as Omit<MatchResult, "bonus">),
    bonus: bonus && season ? { labels: season.map((rp) => rp.label), ...bonus } : null,
  };
}

/** GRITS's time zone: Schedule gives when a role ends as the event's own clock time. */
const SNAPSHOT_TIME_ZONE = "America/New_York";
const PIT_SHIFT_MS = 30 * 60_000;

/**
 * Eight of the demo's students in the pit, the most the Monitor's "In the pit now" is laid out
 * for, in Schedule's shape: half until the next half hour, half until the one after.
 */
export function sampleInThePit(now: number) {
  const shiftEnd = Math.ceil((now + 1) / PIT_SHIFT_MS) * PIT_SHIFT_MS;
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: SNAPSHOT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return DEMO_STUDENTS.slice(0, 8).map((person, index) => ({
    userId: person.id,
    displayName: person.name,
    roleName: index === 0 ? "Pit lead" : "Pit crew",
    until: clock.format(shiftEnd + (index % 2) * PIT_SHIFT_MS),
  }));
}

/** Dev (a local gateway) and staging; never production. */
export const snapshotAvailable = (env: Pick<Bindings, "LOCAL_GATEWAY_URL">) =>
  isStaging || Boolean(env.LOCAL_GATEWAY_URL);

/** When the team switched the snapshot on (ms), or null while it's off or not offered. */
async function snapshotSince(env: Bindings, db: Db, team: string): Promise<number | null> {
  if (!snapshotAvailable(env)) return null;
  const value = Number(await getSetting(db, team, SINCE));
  return value > 0 ? value : null;
}

/** What `GET /monitor/data` answers from the snapshot, or null to ask the services as usual. */
export async function snapshotMonitorData(env: Bindings, db: Db, team: string) {
  const since = await snapshotSince(env, db, team);
  if (since === null) return null;
  const ours = snapshot.rankings.find((r) => r.team === snapshot.teamNumber);
  const clock = Date.now() - since;
  const statuses = statusesAt(
    snapshot.matches.map((match) => match.startOffsetMs),
    clock,
  );
  const matches = snapshot.matches.map((match, index) => {
    const start = since + match.startOffsetMs;
    const scored = match.startOffsetMs + SCORED_AFTER_MS <= clock;
    return {
      label: match.label,
      status: statuses[index],
      redTeams: match.redTeams,
      blueTeams: match.blueTeams,
      times: {
        estimatedQueueTime: start - QUEUE_BEFORE_MS,
        estimatedOnFieldTime: start - ON_FIELD_BEFORE_MS,
        estimatedStartTime: start,
      },
      result: scored ? resultOf(match) : null,
    };
  });
  return {
    teamNumber: snapshot.teamNumber,
    nexus: { isRealNexus: true, matches },
    ourMatches: ourSchedule(matches, snapshot.teamNumber, true),
    // Schedule isn't part of the snapshot: sample people, so "In the pit now" is at its fullest.
    inThePit: sampleInThePit(Date.now()),
    ranking: ours
      ? {
          rank: ours.rank,
          wins: ours.wins,
          losses: ours.losses,
          ties: ours.ties,
          rp: ours.rp,
          epa: 0,
        }
      : null,
    contextRankings: ours ? contextRankingsFor(snapshot.rankings, ours.rank) : null,
    snapshot: { event: snapshot.event, name: snapshot.name, clockMs: clock },
  };
}

const onValidator = validator("json", (value, c) => {
  const v = value as { on?: unknown };
  if (typeof v?.on !== "boolean") return c.json({ error: "on must be a boolean." }, 400);
  return { on: v.on };
});

/** A move of the snapshot's clock: by whole minutes, to the next or last match's start, or back. */
export type ClockMove = { minutes: number } | { matches: 1 | -1 } | { reset: true };

/** The clock after `move`, kept within an hour of the first and last matches. */
export function movedClock(clock: number, move: ClockMove): number {
  let next = clock;
  if ("reset" in move) next = 0;
  else if ("minutes" in move) next = clock + move.minutes * 60_000;
  else {
    const starts = snapshot.matches.map((match) => match.startOffsetMs);
    const found =
      move.matches === 1
        ? Math.min(...starts.filter((start) => start > clock))
        : Math.max(...starts.filter((start) => start < clock));
    if (Number.isFinite(found)) next = found;
  }
  return Math.min(lastStart + CLOCK_MARGIN_MS, Math.max(firstStart - CLOCK_MARGIN_MS, next));
}

const clockValidator = validator("json", (value, c) => {
  const v = (value ?? {}) as { minutes?: unknown; matches?: unknown; reset?: unknown };
  if (v.reset === true) return { reset: true } as ClockMove;
  if (v.matches === 1 || v.matches === -1) return { matches: v.matches } as ClockMove;
  const { minutes } = v;
  if (typeof minutes === "number" && Number.isInteger(minutes) && minutes !== 0) {
    if (Math.abs(minutes) <= 24 * 60) return { minutes } as ClockMove;
  }
  return c.json(
    {
      error: "Send minutes (a whole number, at most a day either way), matches (1 or -1) or reset.",
    },
    400,
  ) as never;
});

export const eventSnapshotRoutes = new Hono<AppEnv>()
  // Whether it's offered here and on, for Pit's Admin page.
  .get("/", requireAdmin, async (c) => {
    const available = snapshotAvailable(c.env);
    const since = await snapshotSince(c.env, createDb(c.env.PIT_DB), c.get("teamId"));
    return c.json({ available, on: since !== null, name: available ? snapshot.name : null });
  })
  .put("/", requireAdmin, onValidator, async (c) => {
    if (!snapshotAvailable(c.env)) return c.json({ error: "Not offered here." }, 404);
    const { on } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const team = c.get("teamId");
    const value = on ? String(Date.now()) : "";
    if (on) {
      await db
        .insert(settings)
        .values(withTeam(team, { key: SINCE, value }))
        .onConflictDoUpdate({ target: [settings.teamId, settings.key], set: { value } });
    } else {
      await db.delete(settings).where(inTeam(settings, team, eq(settings.key, SINCE)));
    }
    await logTeamChange(c.env, team, {
      userId: c.get("userId"),
      app: "pit",
      what: "Pit settings",
      changed: ["Use event snapshot"],
    });
    return c.json({ on });
  })
  // Moves the snapshot's clock on or back (the Monitor's controls). Not logged: it's only for
  // trying the Monitor out.
  .put("/clock", requireAdmin, clockValidator, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const team = c.get("teamId");
    const since = await snapshotSince(c.env, db, team);
    if (since === null) return c.json({ error: "The event snapshot isn't on." }, 404);
    const now = Date.now();
    const clockMs = movedClock(now - since, c.req.valid("json"));
    await db
      .update(settings)
      .set({ value: String(now - clockMs) })
      .where(inTeam(settings, team, eq(settings.key, SINCE)));
    return c.json({ clockMs });
  });
