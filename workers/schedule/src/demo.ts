import { withTeam } from "@g3/auth";
import { DEMO_PEOPLE, type DemoPerson, demoDate, vocabularyOf } from "@g3/demo";
import { site } from "@g3/site-config";
import type { Db } from "./db";
import {
  assignments,
  roles,
  scheduleAttendees,
  scheduleDays,
  schedulePeriods,
  schedules,
} from "./db/schema";

// The public demo's Schedule (roadmap 5.3), loaded after its nightly reset: the team's roles and
// a published two-day event later this week, with periods and everyone's roles painted in.

const ROLES = [
  { name: "Drive Team", color: "green", type: "other" },
  { name: "Scouting", color: "sky", type: "scouting" },
  { name: "Pit", color: "orange", type: "pit" },
  { name: "Break", color: "gray", type: "other" },
  { name: "Lunch", color: "amber", type: "other" },
] as const;

/** 8:00 AM to 6:00 PM, as 15-minute slots of the day. */
const OPEN = 32;
const CLOSE = 72;
const LUNCH = [48, 52] as const;

const PERIODS = [
  { label: "Load in", start: 32, end: 38 },
  { label: "Practice matches", start: 38, end: 48 },
  { label: "Lunch", start: 48, end: 52 },
  { label: "Qualification matches", start: 52, end: 72 },
];

const SCHEDULE_NAME = "District event";

export async function loadDemo(db: Db, teamId: string) {
  const now = new Date();
  const seconds = Math.floor(now.getTime() / 1000);
  const mentor = DEMO_PEOPLE[1] as DemoPerson;

  const roleIds: number[] = [];
  for (const [i, role] of ROLES.entries()) {
    const [row] = await db
      .insert(roles)
      .values(withTeam(teamId, { ...role, sortOrder: i, createdAt: seconds }))
      .returning({ id: roles.id });
    roleIds.push(row.id);
  }

  const [schedule] = await db
    .insert(schedules)
    .values(
      withTeam(teamId, {
        name: SCHEDULE_NAME,
        timeZone: site.demo.timeZone,
        // The demo has no Slack or Discord: nothing to remind anyone of.
        notifyMinutes: null,
        publishedAt: seconds,
        createdBy: mentor.id,
        createdAt: seconds,
        updatedAt: seconds,
      }),
    )
    .returning({ id: schedules.id });
  const scheduleId = schedule.id;
  const days = [demoDate(now, 3), demoDate(now, 4)];

  for (const day of days) {
    await db
      .insert(scheduleDays)
      .values(withTeam(teamId, { scheduleId, day, startSlot: OPEN, endSlot: CLOSE }));
    for (const period of PERIODS) {
      await db.insert(schedulePeriods).values(
        withTeam(teamId, {
          scheduleId,
          day,
          startSlot: period.start,
          endSlot: period.end,
          label: period.label,
        }),
      );
    }
  }
  for (const person of DEMO_PEOPLE) {
    await db
      .insert(scheduleAttendees)
      .values(
        withTeam(teamId, { scheduleId, userId: person.id, addedBy: mentor.id, addedAt: seconds }),
      );
  }

  // Everyone has lunch together; otherwise roles turn over every two hours, each person a step
  // behind the one before, with a break now and then.
  const rows = DEMO_PEOPLE.flatMap((person, p) =>
    days.flatMap((day, d) => {
      const out: Omit<typeof assignments.$inferInsert, "teamId">[] = [];
      for (let slot = OPEN; slot < CLOSE; slot++) {
        const lunch = slot >= LUNCH[0] && slot < LUNCH[1];
        const turn = Math.floor((slot - OPEN) / 8) + p + d;
        const role = lunch ? 4 : turn % 7 === 6 ? 3 : turn % 3;
        out.push({
          scheduleId,
          userId: person.id,
          day,
          slot,
          roleId: roleIds[role] as number,
        });
      }
      return out;
    }),
  );
  // Fifteen rows a statement: D1 takes at most 100 values in one.
  for (let i = 0; i < rows.length; i += 15) {
    await db.insert(assignments).values(rows.slice(i, i + 15).map((row) => withTeam(teamId, row)));
  }
  return { assignments: rows.length };
}

/** The words in the demo's Schedule data, for the gateway. */
export const demoWords = (): string[] => vocabularyOf(ROLES, PERIODS, SCHEDULE_NAME);
