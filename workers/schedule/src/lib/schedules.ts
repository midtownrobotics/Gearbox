import { inTeam, teamMembers } from "@g3/auth";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db";
import {
  assignments,
  roles,
  scheduleAttendees,
  scheduleDays,
  schedulePeriods,
  schedules,
} from "../db/schema";
import { nowSeconds } from "./input";

export type ScheduleRow = typeof schedules.$inferSelect;

/** How many days a schedule has at most (a long event, or a week of build). */
export const MAX_DAYS = 14;
export const MAX_NAME = 100;
export const MAX_LABEL = 60;
/** The most people one schedule has. */
export const MAX_ATTENDEES = 200;

/** The team's schedule with this id, or null (another team's, or none). */
export function findSchedule(db: Db, teamId: string, id: number) {
  return db
    .select()
    .from(schedules)
    .where(inTeam(schedules, teamId, eq(schedules.id, id)))
    .get();
}

/** Marks a schedule as changed: part of the batch that changes it. */
export const touch = (db: Db, teamId: string, id: number) =>
  db
    .update(schedules)
    .set({ updatedAt: nowSeconds() })
    .where(inTeam(schedules, teamId, eq(schedules.id, id)));

/** A schedule as the list shows it. */
export function scheduleSummary(row: ScheduleRow) {
  return {
    id: row.id,
    name: row.name,
    timeZone: row.timeZone,
    notifyMinutes: row.notifyMinutes,
    published: row.publishedAt !== null,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  };
}

/** One person's role over a run of blocks: from `start` up to (not including) `end`. */
export type AssignmentRange = {
  userId: string;
  day: string;
  start: number;
  end: number;
  roleId: number;
};

/** Blocks, one per slot, as runs of the same role (sorted by person, day and slot). */
export function toRanges(
  cells: { userId: string; day: string; slot: number; roleId: number }[],
): AssignmentRange[] {
  const sorted = [...cells].sort(
    (a, b) => a.userId.localeCompare(b.userId) || a.day.localeCompare(b.day) || a.slot - b.slot,
  );
  const out: AssignmentRange[] = [];
  for (const cell of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      last.userId === cell.userId &&
      last.day === cell.day &&
      last.roleId === cell.roleId &&
      last.end === cell.slot
    ) {
      last.end++;
    } else {
      out.push({ ...cell, start: cell.slot, end: cell.slot + 1 });
    }
  }
  return out.map(({ userId, day, start, end, roleId }) => ({ userId, day, start, end, roleId }));
}

/**
 * Everything a schedule's pages show: its days and periods, who's attending (with their names
 * from G3ID), every assignment as ranges, and the team's roles. Students get the same as editors:
 * the whole grid and their own are both views of it.
 */
export async function scheduleDetail(
  env: { G3ID: Fetcher },
  db: Db,
  teamId: string,
  row: ScheduleRow,
) {
  const id = row.id;
  const [days, periods, attendees, cells, teamRoles] = await db.batch([
    db
      .select({ day: scheduleDays.day, start: scheduleDays.startSlot, end: scheduleDays.endSlot })
      .from(scheduleDays)
      .where(inTeam(scheduleDays, teamId, eq(scheduleDays.scheduleId, id)))
      .orderBy(asc(scheduleDays.day)),
    db
      .select({
        id: schedulePeriods.id,
        day: schedulePeriods.day,
        start: schedulePeriods.startSlot,
        end: schedulePeriods.endSlot,
        label: schedulePeriods.label,
      })
      .from(schedulePeriods)
      .where(inTeam(schedulePeriods, teamId, eq(schedulePeriods.scheduleId, id)))
      .orderBy(asc(schedulePeriods.day), asc(schedulePeriods.startSlot)),
    db
      .select({ userId: scheduleAttendees.userId, addedAt: scheduleAttendees.addedAt })
      .from(scheduleAttendees)
      .where(inTeam(scheduleAttendees, teamId, eq(scheduleAttendees.scheduleId, id))),
    db
      .select({
        userId: assignments.userId,
        day: assignments.day,
        slot: assignments.slot,
        roleId: assignments.roleId,
      })
      .from(assignments)
      .where(inTeam(assignments, teamId, eq(assignments.scheduleId, id))),
    db
      .select()
      .from(roles)
      .where(inTeam(roles, teamId))
      .orderBy(asc(roles.sortOrder), asc(roles.id)),
  ]);
  const members = new Map((await teamMembers(env, teamId))?.map((m) => [m.id, m]) ?? []);
  return {
    schedule: scheduleSummary(row),
    days,
    periods,
    attendees: attendees
      .map(({ userId }) => {
        const member = members.get(userId);
        return {
          userId,
          displayName: member?.displayName ?? null,
          isMentor: member?.isMentor ?? false,
          /** False for someone who has since left the team (or G3ID couldn't be asked). */
          active: member?.status === "active",
        };
      })
      .sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "")),
    assignments: toRanges(cells),
    roles: teamRoles.map(roleView),
  };
}

export const roleView = (role: typeof roles.$inferSelect) => ({
  id: role.id,
  name: role.name,
  color: role.color,
  archived: role.archivedAt !== null,
});
