import { activeMembers, inTeam, requireAuth, withTeam } from "@g3/auth";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type Db, createDb } from "../db";
import {
  assignments,
  roles,
  scheduleAttendees,
  scheduleDays,
  schedulePeriods,
  schedules,
} from "../db/schema";
import { canEdit, requireEditor } from "../lib/editors";
import { chunks, nowSeconds, parseId, textField, userIdList } from "../lib/input";
import {
  MAX_ATTENDEES,
  MAX_DAYS,
  MAX_LABEL,
  MAX_NAME,
  findSchedule,
  scheduleDetail,
  scheduleSummary,
  touch,
} from "../lib/schedules";
import { clockLabel, isDay, isRange, isTimeZone, overlaps } from "../lib/slots";
import type { AppEnv } from "../types";

// An event's schedule: its days and labeled periods, who's attending, and each attendee's role
// for every 15-minute block. Everyone signed in reads published schedules; editors (mentors,
// admins and trusted students: lib/editors.ts) read drafts too and change everything.

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Body) : {};

/** The most blocks one request changes (a whole event for a full team). */
const MAX_CELLS = 20_000;
/** Assignment rows per insert: 6 columns each, under D1's 100 bound parameters. */
const CELL_CHUNK = 16;
/** User ids per delete, beside its other parameters. */
const USER_CHUNK = 80;

/** The schedule's id on a route with more in its path (the client then knows every parameter). */
const scheduleIdOf = (c: { req: { param(name: "id"): string } }) => parseId(c.req.param("id"));
const noSchedule = { error: "No such schedule." } as const;

const idParam = validator("param", (value, c): { id: number } => {
  const id = parseId(value.id);
  if (id === null) return c.json({ error: "No such schedule." }, 404) as never;
  return { id };
});

const notifyField = (value: unknown): number | null | undefined =>
  value === null
    ? null
    : typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 120
      ? value
      : undefined;

type ScheduleInput = {
  name?: string;
  timeZone?: string;
  notifyMinutes?: number | null;
  published?: boolean;
};

const scheduleValidator = (partial: boolean) =>
  validator("json", (value, c): ScheduleInput => {
    const v = bodyOf(value);
    const fail = (error: string) => c.json({ error }, 400) as never;
    const out: ScheduleInput = {};
    if (!partial || v.name !== undefined) {
      const name = textField(v.name, MAX_NAME, true);
      if (name === null) return fail(`name must be 1–${MAX_NAME} characters.`);
      out.name = name;
    }
    if (!partial || v.timeZone !== undefined) {
      if (!isTimeZone(v.timeZone))
        return fail("timeZone must be a time zone, like America/Chicago.");
      out.timeZone = v.timeZone;
    }
    if (v.notifyMinutes !== undefined) {
      const notify = notifyField(v.notifyMinutes);
      if (notify === undefined)
        return fail("notifyMinutes must be 0–120, or null for no reminders.");
      out.notifyMinutes = notify;
    }
    if (partial && v.published !== undefined) {
      if (typeof v.published !== "boolean") return fail("published must be true or false.");
      out.published = v.published;
    }
    return out;
  });

const rangeValidator = validator("json", (value, c): { start: number; end: number } => {
  const v = bodyOf(value);
  if (!isRange(v.start, v.end)) {
    return c.json(
      { error: "start and end must be 15-minute slots of the day (0–96), start before end." },
      400,
    ) as never;
  }
  return { start: v.start as number, end: v.end as number };
});

type PeriodInput = { day?: string; start?: number; end?: number; label?: string };

const periodValidator = (partial: boolean) =>
  validator("json", (value, c): PeriodInput => {
    const v = bodyOf(value);
    const fail = (error: string) => c.json({ error }, 400) as never;
    const out: PeriodInput = {};
    if (!partial || v.day !== undefined) {
      if (!isDay(v.day)) return fail("day must be a date, like 2027-03-12.");
      out.day = v.day;
    }
    if (!partial || v.start !== undefined || v.end !== undefined) {
      if (!isRange(v.start, v.end)) {
        return fail("start and end must be 15-minute slots of the day (0–96), start before end.");
      }
      out.start = v.start as number;
      out.end = v.end as number;
    }
    if (!partial || v.label !== undefined) {
      const label = textField(v.label, MAX_LABEL, true);
      if (label === null) return fail(`label must be 1–${MAX_LABEL} characters.`);
      out.label = label;
    }
    return out;
  });

type Change = { userIds: string[]; day: string; start: number; end: number; roleId: number | null };

/** `{ changes }`: runs of blocks to give a role (or clear, with roleId null), applied in order. */
const changesValidator = validator("json", (value, c): { changes: Change[] } => {
  const raw = bodyOf(value).changes;
  const fail = (error: string) => c.json({ error }, 400) as never;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) {
    return fail("changes must be a list of 1–200 changes.");
  }
  const changes: Change[] = [];
  for (const item of raw) {
    const v = bodyOf(item);
    const userIds = userIdList(v.userIds, MAX_ATTENDEES);
    if (userIds === null) return fail("Each change needs userIds: the people it's for.");
    if (!isDay(v.day)) return fail("Each change needs a day, like 2027-03-12.");
    if (!isRange(v.start, v.end)) {
      return fail("Each change needs start and end: 15-minute slots of the day, start before end.");
    }
    const roleId = v.roleId === null ? null : parseId(v.roleId);
    if (roleId === null && v.roleId !== null) {
      return fail("Each change needs a roleId, or null to clear the blocks.");
    }
    changes.push({ userIds, day: v.day, start: v.start as number, end: v.end as number, roleId });
  }
  return { changes };
});

/** The day's hours, or an error a person can act on. */
async function dayOf(db: Db, team: string, scheduleId: number, day: string) {
  return db
    .select({ start: scheduleDays.startSlot, end: scheduleDays.endSlot })
    .from(scheduleDays)
    .where(
      inTeam(
        scheduleDays,
        team,
        eq(scheduleDays.scheduleId, scheduleId),
        eq(scheduleDays.day, day),
      ),
    )
    .get();
}

/** The period on the same day that a range would overlap, if any (`except` itself). */
async function overlappingPeriod(
  db: Db,
  team: string,
  scheduleId: number,
  period: { day: string; start: number; end: number },
  except?: number,
) {
  const sameDay = await db
    .select({
      label: schedulePeriods.label,
      start: schedulePeriods.startSlot,
      end: schedulePeriods.endSlot,
    })
    .from(schedulePeriods)
    .where(
      inTeam(
        schedulePeriods,
        team,
        eq(schedulePeriods.scheduleId, scheduleId),
        eq(schedulePeriods.day, period.day),
        except === undefined ? undefined : ne(schedulePeriods.id, except),
      ),
    )
    .all();
  return sameDay.find((other) => overlaps([other.start, other.end], [period.start, period.end]));
}

const span = (start: number, end: number) => `${clockLabel(start)}–${clockLabel(end)}`;

/** Checks a period against its day's hours and the day's other periods: an error, or null. */
async function periodProblem(
  db: Db,
  team: string,
  scheduleId: number,
  period: { day: string; start: number; end: number },
  except?: number,
): Promise<string | null> {
  const hours = await dayOf(db, team, scheduleId, period.day);
  if (!hours) return "Add that day to the schedule first.";
  if (period.start < hours.start || period.end > hours.end) {
    return `It must be within the day's hours, ${span(hours.start, hours.end)}.`;
  }
  const other = await overlappingPeriod(db, team, scheduleId, period, except);
  if (other) return `It overlaps ${other.label} (${span(other.start, other.end)}).`;
  return null;
}

export const schedulesRouter = new Hono<AppEnv>()
  .use("*", requireAuth)
  // Published schedules, newest first; editors also see drafts.
  .get("/", async (c) => {
    const team = c.get("teamId");
    const editor = await canEdit(c);
    const db = createDb(c.env.SCHEDULE_DB);
    const [rows, days] = await db.batch([
      db
        .select()
        .from(schedules)
        .where(inTeam(schedules, team, editor ? undefined : isNotNull(schedules.publishedAt)))
        .orderBy(desc(schedules.createdAt)),
      db
        .select({ scheduleId: scheduleDays.scheduleId, day: scheduleDays.day })
        .from(scheduleDays)
        .where(inTeam(scheduleDays, team))
        .orderBy(asc(scheduleDays.day)),
    ]);
    return c.json(
      rows.map((row) => {
        const own = days.filter((d) => d.scheduleId === row.id).map((d) => d.day);
        return {
          ...scheduleSummary(row),
          firstDay: own[0] ?? null,
          lastDay: own[own.length - 1] ?? null,
        };
      }),
    );
  })
  .get("/:id", idParam, async (c) => {
    const team = c.get("teamId");
    const db = createDb(c.env.SCHEDULE_DB);
    const row = await findSchedule(db, team, c.req.valid("param").id);
    if (!row || (row.publishedAt === null && !(await canEdit(c)))) {
      return c.json({ error: "No such schedule." }, 404);
    }
    return c.json(await scheduleDetail(c.env, db, team, row));
  })
  .post("/", requireEditor, scheduleValidator(false), async (c) => {
    const team = c.get("teamId");
    const input = c.req.valid("json");
    const now = nowSeconds();
    const row = await createDb(c.env.SCHEDULE_DB)
      .insert(schedules)
      .values(
        withTeam(team, {
          name: input.name as string,
          timeZone: input.timeZone as string,
          notifyMinutes: input.notifyMinutes === undefined ? 5 : input.notifyMinutes,
          createdBy: c.get("userId"),
          createdAt: now,
          updatedAt: now,
        }),
      )
      .returning()
      .get();
    return c.json(scheduleSummary(row), 201);
  })
  // Name, time zone, reminders, and publishing (students and chat reminders see it once it's published).
  .patch("/:id", requireEditor, idParam, scheduleValidator(true), async (c) => {
    const team = c.get("teamId");
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const db = createDb(c.env.SCHEDULE_DB);
    const row = await findSchedule(db, team, id);
    if (!row) return c.json({ error: "No such schedule." }, 404);
    const { published, ...rest } = input;
    const updated = await db
      .update(schedules)
      .set({
        ...rest,
        ...(published === undefined
          ? {}
          : { publishedAt: published ? (row.publishedAt ?? nowSeconds()) : null }),
        updatedAt: nowSeconds(),
      })
      .where(inTeam(schedules, team, eq(schedules.id, id)))
      .returning()
      .get();
    return c.json(scheduleSummary(updated));
  })
  // The whole schedule: its days, periods, attendees and blocks go with it.
  .delete("/:id", requireEditor, idParam, async (c) => {
    const team = c.get("teamId");
    const { id } = c.req.valid("param");
    const deleted = await createDb(c.env.SCHEDULE_DB)
      .delete(schedules)
      .where(inTeam(schedules, team, eq(schedules.id, id)))
      .returning({ id: schedules.id })
      .get();
    if (!deleted) return c.json({ error: "No such schedule." }, 404);
    return c.json({ ok: true });
  })

  // ---- Days: the hours the event runs each day ----

  // Adds a day, or changes its hours. Blocks outside the new hours are cleared; a period outside
  // them has to be moved first.
  .put("/:id/days/:day", requireEditor, rangeValidator, async (c) => {
    const team = c.get("teamId");
    const id = scheduleIdOf(c);
    if (id === null) return c.json(noSchedule, 404);
    const day = c.req.param("day");
    const { start, end } = c.req.valid("json");
    if (!isDay(day)) return c.json({ error: "The day must be a date, like 2027-03-12." }, 400);
    const db = createDb(c.env.SCHEDULE_DB);
    if (!(await findSchedule(db, team, id))) return c.json({ error: "No such schedule." }, 404);
    const [existing, dayCount, outside] = await db.batch([
      db
        .select({ day: scheduleDays.day })
        .from(scheduleDays)
        .where(
          inTeam(scheduleDays, team, eq(scheduleDays.scheduleId, id), eq(scheduleDays.day, day)),
        ),
      db
        .select({ day: scheduleDays.day })
        .from(scheduleDays)
        .where(inTeam(scheduleDays, team, eq(scheduleDays.scheduleId, id))),
      db
        .select({
          label: schedulePeriods.label,
          start: schedulePeriods.startSlot,
          end: schedulePeriods.endSlot,
        })
        .from(schedulePeriods)
        .where(
          inTeam(
            schedulePeriods,
            team,
            eq(schedulePeriods.scheduleId, id),
            eq(schedulePeriods.day, day),
            or(lt(schedulePeriods.startSlot, start), gt(schedulePeriods.endSlot, end)),
          ),
        ),
    ]);
    if (existing.length === 0 && dayCount.length >= MAX_DAYS) {
      return c.json({ error: `A schedule has at most ${MAX_DAYS} days.` }, 400);
    }
    const blocking = outside[0];
    if (blocking) {
      return c.json(
        {
          error: `${blocking.label} (${span(blocking.start, blocking.end)}) is outside those hours. Move or remove it first.`,
        },
        409,
      );
    }
    await db.batch([
      db
        .insert(scheduleDays)
        .values(withTeam(team, { scheduleId: id, day, startSlot: start, endSlot: end }))
        .onConflictDoUpdate({
          target: [scheduleDays.scheduleId, scheduleDays.day],
          set: { startSlot: start, endSlot: end },
        }),
      db
        .delete(assignments)
        .where(
          inTeam(
            assignments,
            team,
            eq(assignments.scheduleId, id),
            eq(assignments.day, day),
            or(lt(assignments.slot, start), gte(assignments.slot, end)),
          ),
        ),
      touch(db, team, id),
    ]);
    return c.json({ day, start, end });
  })
  // A day, with its periods and blocks.
  .delete("/:id/days/:day", requireEditor, async (c) => {
    const team = c.get("teamId");
    const id = scheduleIdOf(c);
    if (id === null) return c.json(noSchedule, 404);
    const db = createDb(c.env.SCHEDULE_DB);
    const [deleted] = await db.batch([
      db
        .delete(scheduleDays)
        .where(
          inTeam(
            scheduleDays,
            team,
            eq(scheduleDays.scheduleId, id),
            eq(scheduleDays.day, c.req.param("day")),
          ),
        )
        .returning({ day: scheduleDays.day }),
      touch(db, team, id),
    ]);
    if (deleted.length === 0) return c.json({ error: "No such day." }, 404);
    return c.json({ ok: true });
  })

  // ---- Periods: the event's labeled agenda (Load in, Lunch, Practice Matches) ----

  .post("/:id/periods", requireEditor, idParam, periodValidator(false), async (c) => {
    const team = c.get("teamId");
    const { id } = c.req.valid("param");
    const input = c.req.valid("json") as Required<PeriodInput>;
    const db = createDb(c.env.SCHEDULE_DB);
    if (!(await findSchedule(db, team, id))) return c.json({ error: "No such schedule." }, 404);
    const problem = await periodProblem(db, team, id, input);
    if (problem) return c.json({ error: problem }, 400);
    const [row] = await db.batch([
      db
        .insert(schedulePeriods)
        .values(
          withTeam(team, {
            scheduleId: id,
            day: input.day,
            startSlot: input.start,
            endSlot: input.end,
            label: input.label,
          }),
        )
        .returning({ id: schedulePeriods.id }),
      touch(db, team, id),
    ]);
    return c.json({ id: row[0].id, ...input }, 201);
  })
  .patch("/:id/periods/:periodId", requireEditor, periodValidator(true), async (c) => {
    const team = c.get("teamId");
    const id = scheduleIdOf(c);
    if (id === null) return c.json(noSchedule, 404);
    const periodId = parseId(c.req.param("periodId"));
    const db = createDb(c.env.SCHEDULE_DB);
    const existing =
      periodId === null
        ? undefined
        : await db
            .select()
            .from(schedulePeriods)
            .where(
              inTeam(
                schedulePeriods,
                team,
                eq(schedulePeriods.scheduleId, id),
                eq(schedulePeriods.id, periodId),
              ),
            )
            .get();
    if (!existing || periodId === null) return c.json({ error: "No such period." }, 404);
    const input = c.req.valid("json");
    const next = {
      day: input.day ?? existing.day,
      start: input.start ?? existing.startSlot,
      end: input.end ?? existing.endSlot,
      label: input.label ?? existing.label,
    };
    const problem = await periodProblem(db, team, id, next, periodId);
    if (problem) return c.json({ error: problem }, 400);
    await db.batch([
      db
        .update(schedulePeriods)
        .set({ day: next.day, startSlot: next.start, endSlot: next.end, label: next.label })
        .where(inTeam(schedulePeriods, team, eq(schedulePeriods.id, periodId))),
      touch(db, team, id),
    ]);
    return c.json({ id: periodId, ...next });
  })
  .delete("/:id/periods/:periodId", requireEditor, async (c) => {
    const team = c.get("teamId");
    const id = scheduleIdOf(c);
    if (id === null) return c.json(noSchedule, 404);
    const periodId = parseId(c.req.param("periodId"));
    if (periodId === null) return c.json({ error: "No such period." }, 404);
    const db = createDb(c.env.SCHEDULE_DB);
    const [deleted] = await db.batch([
      db
        .delete(schedulePeriods)
        .where(
          inTeam(
            schedulePeriods,
            team,
            eq(schedulePeriods.scheduleId, id),
            eq(schedulePeriods.id, periodId),
          ),
        )
        .returning({ id: schedulePeriods.id }),
      touch(db, team, id),
    ]);
    if (deleted.length === 0) return c.json({ error: "No such period." }, 404);
    return c.json({ ok: true });
  })

  // ---- Attendees: the members going, who are the grid's rows ----

  .post(
    "/:id/attendees",
    requireEditor,
    idParam,
    validator("json", (value, c): { userIds: string[] } => {
      const userIds = userIdList(bodyOf(value).userIds, MAX_ATTENDEES);
      if (userIds === null) {
        return c.json(
          { error: `userIds must be a list of 1–${MAX_ATTENDEES} people.` },
          400,
        ) as never;
      }
      return { userIds };
    }),
    async (c) => {
      const team = c.get("teamId");
      const { id } = c.req.valid("param");
      const { userIds } = c.req.valid("json");
      const db = createDb(c.env.SCHEDULE_DB);
      if (!(await findSchedule(db, team, id))) return c.json({ error: "No such schedule." }, 404);
      const members = await activeMembers(c.env, team);
      if (!members) return c.json({ error: "Couldn't load the team's members. Try again." }, 503);
      const active = new Set(members.map((m) => m.id));
      if (!userIds.every((userId) => active.has(userId))) {
        return c.json({ error: "Only the team's active members can attend." }, 400);
      }
      const current = await db
        .select({ userId: scheduleAttendees.userId })
        .from(scheduleAttendees)
        .where(inTeam(scheduleAttendees, team, eq(scheduleAttendees.scheduleId, id)))
        .all();
      const have = new Set(current.map((row) => row.userId));
      const added = userIds.filter((userId) => !have.has(userId));
      if (have.size + added.length > MAX_ATTENDEES) {
        return c.json({ error: `A schedule has at most ${MAX_ATTENDEES} people.` }, 400);
      }
      const now = nowSeconds();
      const inserts: BatchItem<"sqlite">[] = chunks(added, 18).map((group) =>
        db
          .insert(scheduleAttendees)
          .values(
            withTeam(
              team,
              group.map((userId) => ({
                scheduleId: id,
                userId,
                addedBy: c.get("userId"),
                addedAt: now,
              })),
            ),
          )
          .onConflictDoNothing(),
      );
      await db.batch([touch(db, team, id), ...inserts]);
      return c.json({ added });
    },
  )
  // Someone who isn't going after all: their blocks go with them.
  .delete("/:id/attendees/:userId", requireEditor, async (c) => {
    const team = c.get("teamId");
    const id = scheduleIdOf(c);
    if (id === null) return c.json(noSchedule, 404);
    const db = createDb(c.env.SCHEDULE_DB);
    const [deleted] = await db.batch([
      db
        .delete(scheduleAttendees)
        .where(
          inTeam(
            scheduleAttendees,
            team,
            eq(scheduleAttendees.scheduleId, id),
            eq(scheduleAttendees.userId, c.req.param("userId")),
          ),
        )
        .returning({ userId: scheduleAttendees.userId }),
      touch(db, team, id),
    ]);
    if (deleted.length === 0) return c.json({ error: "They aren't attending." }, 404);
    return c.json({ ok: true });
  })

  // ---- Assignments: each attendee's role for every block ----

  // Gives runs of blocks a role, or clears them (roleId null), in one all-or-nothing batch. Later
  // changes win over earlier ones in the same request.
  .put("/:id/assignments", requireEditor, idParam, changesValidator, async (c) => {
    const team = c.get("teamId");
    const { id } = c.req.valid("param");
    const { changes } = c.req.valid("json");
    const db = createDb(c.env.SCHEDULE_DB);
    if (!(await findSchedule(db, team, id))) return c.json({ error: "No such schedule." }, 404);
    const [days, attendees, usable] = await db.batch([
      db
        .select({ day: scheduleDays.day, start: scheduleDays.startSlot, end: scheduleDays.endSlot })
        .from(scheduleDays)
        .where(inTeam(scheduleDays, team, eq(scheduleDays.scheduleId, id))),
      db
        .select({ userId: scheduleAttendees.userId })
        .from(scheduleAttendees)
        .where(inTeam(scheduleAttendees, team, eq(scheduleAttendees.scheduleId, id))),
      db
        .select({ id: roles.id })
        .from(roles)
        .where(inTeam(roles, team, isNull(roles.archivedAt))),
    ]);
    const hours = new Map(days.map((d) => [d.day, d]));
    const going = new Set(attendees.map((a) => a.userId));
    const roleIds = new Set(usable.map((r) => r.id));

    let cells = 0;
    for (const change of changes) {
      const day = hours.get(change.day);
      if (!day) return c.json({ error: `${change.day} isn't one of the schedule's days.` }, 400);
      if (change.start < day.start || change.end > day.end) {
        return c.json(
          { error: `Blocks on ${change.day} must be within ${span(day.start, day.end)}.` },
          400,
        );
      }
      if (!change.userIds.every((userId) => going.has(userId))) {
        return c.json({ error: "Only people attending can be given blocks." }, 400);
      }
      if (change.roleId !== null && !roleIds.has(change.roleId)) {
        return c.json({ error: "That role doesn't exist or is archived." }, 400);
      }
      cells += change.userIds.length * (change.end - change.start);
    }
    if (cells > MAX_CELLS) {
      return c.json({ error: `That's more than ${MAX_CELLS} blocks at once.` }, 400);
    }

    const statements: BatchItem<"sqlite">[] = [touch(db, team, id)];
    for (const change of changes) {
      for (const group of chunks(change.userIds, USER_CHUNK)) {
        statements.push(
          db
            .delete(assignments)
            .where(
              inTeam(
                assignments,
                team,
                eq(assignments.scheduleId, id),
                inArray(assignments.userId, group),
                eq(assignments.day, change.day),
                and(gte(assignments.slot, change.start), lt(assignments.slot, change.end)),
              ),
            ),
        );
      }
      if (change.roleId === null) continue;
      const rows = change.userIds.flatMap((userId) =>
        Array.from({ length: change.end - change.start }, (_, i) => ({
          scheduleId: id,
          userId,
          day: change.day,
          slot: change.start + i,
          roleId: change.roleId as number,
        })),
      );
      for (const group of chunks(rows, CELL_CHUNK)) {
        statements.push(db.insert(assignments).values(withTeam(team, group)));
      }
    }
    const [first, ...rest] = statements;
    await db.batch([first, ...rest]);
    return c.json({ ok: true, blocks: cells });
  });
