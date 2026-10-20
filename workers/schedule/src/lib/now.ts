import { inTeam, teamMembers } from "@g3/auth";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db";
import { assignments, roles, scheduleDays, schedules } from "../db/schema";
import type { RoleType } from "./roles";
import { momentOf, slotAt, timeOf } from "./slots";

// Who has a role of one type right now, across the team's published schedules: Pit's "In the pit
// now". A schedule counts while now, in its event's time zone, is within one of its days' hours.

export type PersonNow = {
  userId: string;
  displayName: string | null;
  roleId: number;
  roleName: string;
  roleColor: string;
  /** When the role ends, as the event's wall-clock time ("12:15"; "24:00" for midnight). */
  until: string;
  /** When this stretch of the role started and ends, as moments (ms), for other apps' clocks. */
  startsAt: number;
  endsAt: number;
  scheduleId: number;
  scheduleName: string;
};

/** The UTC dates around now: every event's local date today is one of them. */
const nearbyDays = (now: Date) =>
  [-1, 0, 1].map((offset) =>
    new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10),
  );

export async function peopleNow(
  env: { G3ID: Fetcher },
  db: Db,
  teamId: string,
  type: RoleType,
  now = new Date(),
): Promise<PersonNow[]> {
  const days = await db
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
    .where(
      inTeam(
        schedules,
        teamId,
        isNotNull(schedules.publishedAt),
        inArray(scheduleDays.day, nearbyDays(now)),
      ),
    )
    .all();

  const out: Omit<PersonNow, "displayName">[] = [];
  const seen = new Set<string>();
  for (const day of days) {
    const here = slotAt(now, day.timeZone);
    if (here.day !== day.day || here.slot < day.start || here.slot >= day.end) continue;
    // The whole day: enough to see where each person's role started and ends.
    const cells = await db
      .select({
        userId: assignments.userId,
        slot: assignments.slot,
        roleId: assignments.roleId,
        roleName: roles.name,
        roleColor: roles.color,
        roleType: roles.type,
      })
      .from(assignments)
      .innerJoin(roles, and(eq(roles.id, assignments.roleId), eq(roles.teamId, assignments.teamId)))
      .where(
        inTeam(
          assignments,
          teamId,
          eq(assignments.scheduleId, day.id),
          eq(assignments.day, day.day),
          gte(assignments.slot, day.start),
        ),
      )
      .all();
    const byPerson = new Map<string, Map<number, (typeof cells)[number]>>();
    for (const cell of cells) {
      const slots = byPerson.get(cell.userId) ?? new Map();
      slots.set(cell.slot, cell);
      byPerson.set(cell.userId, slots);
    }
    for (const [userId, slots] of byPerson) {
      const current = slots.get(here.slot);
      if (!current || current.roleType !== type || seen.has(userId)) continue;
      let end = here.slot + 1;
      while (slots.get(end)?.roleId === current.roleId) end++;
      let start = here.slot;
      while (slots.get(start - 1)?.roleId === current.roleId) start--;
      seen.add(userId);
      out.push({
        userId,
        roleId: current.roleId,
        roleName: current.roleName,
        roleColor: current.roleColor,
        until: timeOf(end),
        startsAt: momentOf(day.day, start, day.timeZone),
        endsAt: momentOf(day.day, end, day.timeZone),
        scheduleId: day.id,
        scheduleName: day.name,
      });
    }
  }
  if (out.length === 0) return [];

  const names = new Map((await teamMembers(env, teamId))?.map((m) => [m.id, m.displayName]) ?? []);
  return out
    .map((person) => ({ ...person, displayName: names.get(person.userId) ?? null }))
    .sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? ""));
}
