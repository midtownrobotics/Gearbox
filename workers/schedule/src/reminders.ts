import { inTeam, sendMemberDM, withTeam } from "@g3/auth";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { type Db, createDb } from "./db";
import { assignments, notificationsSent, roles, scheduleDays, schedules } from "./db/schema";
import { nowSeconds } from "./lib/input";
import { SLOT_MINUTES, clockLabel, slotAt } from "./lib/slots";
import type { AppEnv } from "./types";

// Slack reminders, run every minute (wrangler.toml's cron). Each published schedule with
// reminders on DMs each attendee `notify_minutes` before a block where their role changes:
// "At 10:00 AM you're on Pit until 12:15 PM". Only a change gets a message, not every block, and
// `notifications_sent` makes sure each one goes once even if runs overlap or repeat.

/** How late a run can be and still send a reminder (a cron run can be delayed). */
const LATE_MINUTES = 3;

type Due = { scheduleId: number; teamId: string; name: string; day: string; slot: number };

/** The block each schedule should remind about now, if one starts within its reminder time. */
export function dueBlock(
  schedule: { notifyMinutes: number; timeZone: string },
  now: Date,
): { day: string; slot: number } | null {
  const target = slotAt(
    new Date(now.getTime() + schedule.notifyMinutes * 60_000),
    schedule.timeZone,
  );
  // Minutes from now until that block starts: past it by the time we're into it.
  const startsIn = schedule.notifyMinutes - (target.minutes % SLOT_MINUTES);
  return startsIn > -LATE_MINUTES ? { day: target.day, slot: target.slot } : null;
}

/** The UTC dates around now: every event's local date today is one of them. */
function nearbyDays(now: Date): string[] {
  return [-1, 0, 1].map((offset) =>
    new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10),
  );
}

/** Schedules (every team's) that could have a reminder due: published, reminders on, running now. */
async function runningSchedules(db: Db, now: Date) {
  // tenancy: all teams (the cron finds which schedules run today, then works within each one's team)
  return db
    .selectDistinct({
      id: schedules.id,
      teamId: schedules.teamId,
      name: schedules.name,
      timeZone: schedules.timeZone,
      notifyMinutes: schedules.notifyMinutes,
    })
    .from(schedules)
    .innerJoin(scheduleDays, eq(scheduleDays.scheduleId, schedules.id))
    .where(
      and(
        isNotNull(schedules.publishedAt),
        isNotNull(schedules.notifyMinutes),
        inArray(scheduleDays.day, nearbyDays(now)),
      ),
    )
    .all();
}

/** Sends one schedule's reminders for a block. */
async function remind(env: AppEnv["Bindings"], db: Db, due: Due) {
  const { teamId, scheduleId, day, slot } = due;
  const [cells, teamRoles] = await db.batch([
    db
      .select({ userId: assignments.userId, slot: assignments.slot, roleId: assignments.roleId })
      .from(assignments)
      .where(
        inTeam(
          assignments,
          teamId,
          eq(assignments.scheduleId, scheduleId),
          eq(assignments.day, day),
        ),
      ),
    db.select({ id: roles.id, name: roles.name }).from(roles).where(inTeam(roles, teamId)),
  ]);
  const roleNames = new Map(teamRoles.map((r) => [r.id, r.name]));
  const byPerson = new Map<string, Map<number, number>>();
  for (const cell of cells) {
    const slots = byPerson.get(cell.userId) ?? new Map<number, number>();
    slots.set(cell.slot, cell.roleId);
    byPerson.set(cell.userId, slots);
  }

  for (const [userId, slots] of byPerson) {
    const role = slots.get(slot);
    if (role === undefined || slots.get(slot - 1) === role) continue;
    let end = slot + 1;
    while (slots.get(end) === role) end++;

    // Claim it first: whichever run inserts the row is the one that sends.
    const claimed = await db
      .insert(notificationsSent)
      .values(withTeam(teamId, { scheduleId, userId, day, slot, sentAt: nowSeconds() }))
      .onConflictDoNothing()
      .returning({ userId: notificationsSent.userId })
      .get();
    if (!claimed) continue;
    const text = `${due.name}: at ${clockLabel(slot)} you're on *${roleNames.get(role) ?? "a new role"}* until ${clockLabel(end)}.`;
    await sendMemberDM(env, teamId, [userId], text);
  }
}

/** The cron: every schedule's reminders that are due now. */
export async function sendReminders(env: AppEnv["Bindings"], now = new Date()) {
  const db = createDb(env.SCHEDULE_DB);
  for (const schedule of await runningSchedules(db, now)) {
    if (schedule.notifyMinutes === null) continue;
    const block = dueBlock(
      { notifyMinutes: schedule.notifyMinutes, timeZone: schedule.timeZone },
      now,
    );
    if (!block) continue;
    try {
      await remind(env, db, {
        scheduleId: schedule.id,
        teamId: schedule.teamId,
        name: schedule.name,
        ...block,
      });
    } catch (err) {
      console.error("[schedule] reminders failed", schedule.teamId, schedule.id, err);
    }
  }
}
