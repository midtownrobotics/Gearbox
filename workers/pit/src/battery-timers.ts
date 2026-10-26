import { inTeam, requireAuth, teamHasApp, withTeam } from "@g3/auth";
import { type SQL, eq, exists, isNotNull, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type Db, createDb } from "./db";
import { batteries, settings } from "./db/schema";
import type { InternalSettingKey } from "./settings";
import type { AppEnv } from "./types";

// Battery timers: how long each battery has been in its state, counted only while the team's
// timers run. Most events turn the power off overnight, so a charger isn't charging then.
//
// Each battery keeps the time counted so far (`countedMs`) and when it started counting again
// (`countingSince`, null while paused). Anyone signed in pauses or unpauses every timer at once
// (`POST /batteries/timers`), which never changes a battery's state. On the days of the team's
// published Schedule events, the timers also follow the event's hours:
// - when the first day opens, every timer goes back to zero and pauses (the chargers may not have
//   power yet: someone unpauses them);
// - when a day closes, they pause;
// - when a later day opens, they carry on.
// These are applied at the moment they happen, by the next request that reads or changes the
// batteries (`catchUp`), so nothing needs to be running at that moment.

type Env = AppEnv["Bindings"];

/** A Schedule event's days: when each opens and closes (Unix ms), in order. */
export type EventDays = { days: { day: string; opensAt: number; closesAt: number }[] };

export type TimerChange = { at: number; kind: "reset" | "pause" | "resume" };

/** What the Batteries page shows: whether the timers are paused, and the next automatic change. */
export type TimerState = { paused: boolean; next: TimerChange | null };

const PAUSED: InternalSettingKey = "batteryTimersPaused";
/** Unix ms: the Schedule's changes up to this moment have been applied. */
const APPLIED: InternalSettingKey = "batteryTimersAppliedAt";
/** The team's event days as Schedule last gave them, with when (`checkedAt`). */
const EVENTS: InternalSettingKey = "batteryTimersEvents";
/** How long Schedule's answer is used before it's asked again. */
const EVENTS_TTL_MS = 2 * 60_000;

const ORDER: Record<TimerChange["kind"], number> = { pause: 0, reset: 1, resume: 2 };

/** Every automatic change the team's events make, in order. */
export function timerChanges(events: EventDays[]): TimerChange[] {
  const changes: TimerChange[] = [];
  for (const event of events) {
    event.days.forEach((day, i) => {
      changes.push({ at: day.opensAt, kind: i === 0 ? "reset" : "resume" });
      changes.push({ at: day.closesAt, kind: "pause" });
    });
  }
  return changes.sort((a, b) => a.at - b.at || ORDER[a.kind] - ORDER[b.kind]);
}

async function readSettings(db: Db, team: string) {
  const rows = await db.select().from(settings).where(inTeam(settings, team));
  const value = (key: InternalSettingKey) => rows.find((row) => row.key === key)?.value;
  let cached: { checkedAt: number; events: EventDays[] } | null = null;
  try {
    cached = JSON.parse(value(EVENTS) ?? "null");
  } catch {}
  const applied = value(APPLIED);
  return {
    paused: value(PAUSED) === "1",
    appliedAt: applied ? Number(applied) : null,
    cached,
  };
}

/** The team's event days, from Schedule at most every EVENTS_TTL_MS; none without Schedule. */
async function teamEvents(
  env: Env,
  db: Db,
  team: string,
  cached: { checkedAt: number; events: EventDays[] } | null,
  now: number,
): Promise<EventDays[]> {
  if (cached && now - cached.checkedAt < EVENTS_TTL_MS) return cached.events;
  let events: EventDays[] | null = null;
  if (!env.SCHEDULE || (await teamHasApp(env, team, "schedule")) === false) {
    events = [];
  } else {
    try {
      const res = await env.SCHEDULE.fetch(
        `http://schedule/api/internal/teams/${encodeURIComponent(team)}/event-days`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (res.ok) events = ((await res.json()) as { events: EventDays[] }).events;
    } catch {}
  }
  // Schedule didn't answer: keep what it said last time, and ask again next time.
  if (events === null) return cached?.events ?? [];
  const value = JSON.stringify({ checkedAt: now, events });
  await db
    .insert(settings)
    .values(withTeam(team, { key: EVENTS, value }))
    .onConflictDoUpdate({ target: [settings.teamId, settings.key], set: { value } });
  return events;
}

/** Every timer stops at `at`, keeping what it had counted. */
const pauseAll = (db: Db, team: string, at: number, ...also: SQL[]) =>
  db
    .update(batteries)
    .set({
      countedMs: sql`${batteries.countedMs} + max(0, ${at} - ${batteries.countingSince})`,
      countingSince: null,
    })
    .where(inTeam(batteries, team, isNotNull(batteries.countingSince), ...also));

/** Every stopped timer counts again from `at`. */
const resumeAll = (db: Db, team: string, at: number, ...also: SQL[]) =>
  db
    .update(batteries)
    .set({ countingSince: at })
    .where(inTeam(batteries, team, isNull(batteries.countingSince), ...also));

const setPaused = (db: Db, team: string, paused: boolean, ...also: SQL[]) =>
  db
    .update(settings)
    .set({ value: paused ? "1" : "" })
    .where(inTeam(settings, team, eq(settings.key, PAUSED), ...also));

/**
 * Applies the automatic changes due since the last request, each at the moment it was due, and
 * says where the timers stand. Every route that reads or changes the batteries' timers calls it
 * first. The first time, nothing before now is applied.
 */
export async function catchUp(
  env: Env,
  db: Db,
  team: string,
  now = Date.now(),
): Promise<TimerState> {
  const state = await readSettings(db, team);
  const changes = timerChanges(await teamEvents(env, db, team, state.cached, now));
  const next = changes.find((change) => change.at > now) ?? null;

  if (state.appliedAt === null) {
    await db.batch([
      db
        .insert(settings)
        .values(withTeam(team, { key: PAUSED, value: "" }))
        .onConflictDoNothing(),
      db
        .insert(settings)
        .values(withTeam(team, { key: APPLIED, value: String(now) }))
        .onConflictDoNothing(),
    ]);
    return { paused: state.paused, next };
  }

  const appliedAt = state.appliedAt;
  const due = changes.filter((change) => change.at > appliedAt && change.at <= now);
  if (due.length === 0) return { paused: state.paused, next };

  // Applied only if no other request has applied them first.
  const stillDue = exists(
    db
      .select({ one: sql`1` })
      .from(settings)
      .where(
        inTeam(settings, team, eq(settings.key, APPLIED), eq(settings.value, String(appliedAt))),
      ),
  );
  const statements: BatchItem<"sqlite">[] = [];
  for (const change of due) {
    if (change.kind === "pause") statements.push(pauseAll(db, team, change.at, stillDue));
    if (change.kind === "resume") statements.push(resumeAll(db, team, change.at, stillDue));
    if (change.kind === "reset") {
      statements.push(
        db
          .update(batteries)
          .set({ countedMs: 0, countingSince: null })
          .where(inTeam(batteries, team, stillDue)),
      );
    }
  }
  const paused = due[due.length - 1].kind !== "resume";
  statements.push(setPaused(db, team, paused, stillDue));
  statements.push(
    db
      .update(settings)
      .set({ value: String(now) })
      .where(
        inTeam(settings, team, eq(settings.key, APPLIED), eq(settings.value, String(appliedAt))),
      ),
  );
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return { paused, next };
}

/** Where a battery's timer starts when its state changes: zero, and counting unless paused. */
export const freshTimer = (paused: boolean, now = Date.now()) => ({
  countedMs: 0,
  countingSince: paused ? null : now,
});

/** Pause All or Unpause All, at `now`. */
export async function pauseTimers(db: Db, team: string, paused: boolean, now = Date.now()) {
  const value = paused ? "1" : "";
  await db.batch([
    paused ? pauseAll(db, team, now) : resumeAll(db, team, now),
    db
      .insert(settings)
      .values(withTeam(team, { key: PAUSED, value }))
      .onConflictDoUpdate({ target: [settings.teamId, settings.key], set: { value } }),
  ]);
}

const pausedValidator = validator("json", (value, c) => {
  const v = value as { paused?: unknown };
  if (typeof v?.paused !== "boolean") return c.json({ error: "paused must be a boolean." }, 400);
  return { paused: v.paused };
});

export const timerRoutes = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) =>
    c.json(await catchUp(c.env, createDb(c.env.PIT_DB), c.get("teamId"))),
  )
  // Pause All and Unpause All: every timer stops or carries on; no battery changes state.
  .post("/", requireAuth, pausedValidator, async (c) => {
    const { paused } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const team = c.get("teamId");
    const { next } = await catchUp(c.env, db, team);
    await pauseTimers(db, team, paused);
    return c.json({ paused, next } satisfies TimerState);
  });
