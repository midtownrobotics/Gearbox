import { inTeam } from "@g3/auth";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db";
import { scheduleDays, schedules } from "../db/schema";
import { momentOf } from "./slots";

// When each of the team's events opens and closes, day by day, for other apps: Pit pauses its
// battery timers overnight. Only published schedules count, and only events that haven't been
// over for more than a couple of days.

export type EventDays = {
  scheduleId: number;
  name: string;
  /** In order. `opensAt` and `closesAt` are Unix ms: the day's hours in the event's time zone. */
  days: { day: string; opensAt: number; closesAt: number }[];
};

const RECENT_MS = 2 * 86_400_000;

export async function eventDays(db: Db, teamId: string, now = Date.now()): Promise<EventDays[]> {
  const rows = await db
    .select({
      id: schedules.id,
      name: schedules.name,
      timeZone: schedules.timeZone,
      day: scheduleDays.day,
      start: scheduleDays.startSlot,
      end: scheduleDays.endSlot,
    })
    .from(schedules)
    .innerJoin(
      scheduleDays,
      and(eq(scheduleDays.scheduleId, schedules.id), eq(scheduleDays.teamId, schedules.teamId)),
    )
    .where(inTeam(schedules, teamId, isNotNull(schedules.publishedAt)))
    .orderBy(schedules.id, scheduleDays.day)
    .all();

  const events = new Map<number, EventDays>();
  for (const row of rows) {
    const event = events.get(row.id) ?? { scheduleId: row.id, name: row.name, days: [] };
    event.days.push({
      day: row.day,
      opensAt: momentOf(row.day, row.start, row.timeZone),
      closesAt: momentOf(row.day, row.end, row.timeZone),
    });
    events.set(row.id, event);
  }
  return [...events.values()].filter(
    (event) => event.days[event.days.length - 1].closesAt > now - RECENT_MS,
  );
}
