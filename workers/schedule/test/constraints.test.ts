import { env } from "cloudflare:test";
import { expect, it } from "vitest";

// The rules the database keeps by itself, whatever a route forgets: blocks only for attendees,
// on the event's days and the 15-minute grid, one role per person per block, and nothing left
// behind when an attendee, a day or a schedule goes.

const database = (env as unknown as { SCHEDULE_DB: D1Database }).SCHEDULE_DB;
const run = (query: string, ...values: unknown[]) =>
  database
    .prepare(query)
    .bind(...values)
    .run();
const count = async (table: string, scheduleId: number) =>
  (
    await database
      .prepare(`SELECT count(*) AS n FROM ${table} WHERE schedule_id = ?`)
      .bind(scheduleId)
      .first<{ n: number }>()
  )?.n;

async function setUp() {
  const schedule = await database
    .prepare(
      "INSERT INTO schedules (team_id, name, time_zone, created_by, created_at, updated_at) VALUES ('frc1648', 'Regional', 'America/Chicago', 'm', 0, 0) RETURNING id",
    )
    .first<{ id: number }>();
  const id = schedule?.id as number;
  const role = await database
    .prepare(
      "INSERT INTO roles (team_id, name, color, created_at) VALUES ('frc1648', 'Pit', 'blue', 0) RETURNING id",
    )
    .first<{ id: number }>();
  await run(
    "INSERT INTO schedule_days (team_id, schedule_id, day, start_slot, end_slot) VALUES ('frc1648', ?, '2027-03-12', 32, 72)",
    id,
  );
  await run(
    "INSERT INTO schedule_attendees (team_id, schedule_id, user_id, added_by, added_at) VALUES ('frc1648', ?, 'jordan', 'm', 0)",
    id,
  );
  const assign = (user: string, day: string, slot: number) =>
    run(
      "INSERT INTO assignments (team_id, schedule_id, user_id, day, slot, role_id) VALUES ('frc1648', ?, ?, ?, ?, ?)",
      id,
      user,
      day,
      slot,
      role?.id,
    );
  return { id, assign };
}

it("assigns blocks only to attendees, on the event's days, on the grid, once each", async () => {
  const { assign } = await setUp();
  await assign("jordan", "2027-03-12", 40);
  await expect(assign("jordan", "2027-03-12", 40)).rejects.toThrow(/UNIQUE|PRIMARY/);
  await expect(assign("someone-else", "2027-03-12", 41)).rejects.toThrow(/FOREIGN KEY/);
  await expect(assign("jordan", "2027-03-13", 41)).rejects.toThrow(/FOREIGN KEY/);
  await expect(assign("jordan", "2027-03-12", 96)).rejects.toThrow(/CHECK/);
});

it("keeps a day's hours and a period's times in order", async () => {
  const { id } = await setUp();
  await expect(
    run(
      "INSERT INTO schedule_days (team_id, schedule_id, day, start_slot, end_slot) VALUES ('frc1648', ?, '2027-03-13', 60, 40)",
      id,
    ),
  ).rejects.toThrow(/CHECK/);
  await expect(
    run(
      "INSERT INTO schedule_periods (team_id, schedule_id, day, start_slot, end_slot, label) VALUES ('frc1648', ?, '2027-03-12', 53, 48, 'Lunch')",
      id,
    ),
  ).rejects.toThrow(/CHECK/);
  await expect(
    run(
      "INSERT INTO schedule_periods (team_id, schedule_id, day, start_slot, end_slot, label) VALUES ('frc1648', ?, '2027-03-14', 48, 53, 'Lunch')",
      id,
    ),
  ).rejects.toThrow(/FOREIGN KEY/);
});

it("removes an attendee's blocks with them, a day's with it, and everything with the schedule", async () => {
  const { id, assign } = await setUp();
  await run(
    "INSERT INTO schedule_days (team_id, schedule_id, day, start_slot, end_slot) VALUES ('frc1648', ?, '2027-03-13', 32, 72)",
    id,
  );
  await assign("jordan", "2027-03-12", 40);
  await assign("jordan", "2027-03-13", 40);

  await run("DELETE FROM schedule_days WHERE schedule_id = ? AND day = '2027-03-13'", id);
  expect(await count("assignments", id)).toBe(1);

  await run("DELETE FROM schedule_attendees WHERE schedule_id = ?", id);
  expect(await count("assignments", id)).toBe(0);

  await run(
    "INSERT INTO schedule_periods (team_id, schedule_id, day, start_slot, end_slot, label) VALUES ('frc1648', ?, '2027-03-12', 48, 53, 'Lunch')",
    id,
  );
  await run("DELETE FROM schedules WHERE id = ?", id);
  expect(await count("schedule_days", id)).toBe(0);
  expect(await count("schedule_periods", id)).toBe(0);
});

it("won't delete a role that's still assigned", async () => {
  const { assign } = await setUp();
  await assign("jordan", "2027-03-12", 40);
  await expect(run("DELETE FROM roles WHERE name = 'Pit'")).rejects.toThrow(/FOREIGN KEY/);
});
