import { env } from "cloudflare:test";
import {
  type Seeded,
  checkIsolation,
  checkTeamDeletion,
  checkTeamExport,
} from "@g3/testing/isolation";
import type { TeamUsers } from "@g3/testing/users";
import { call } from "@g3/testing/worker";
import { expect, it } from "vitest";
import { app } from "../src/index";

// Two teams, each with a published schedule: a day, a period, a role, an attendee with blocks
// assigned, a Slack DM sent, and a trusted editor. Every route, called as team A's admin, mentor,
// student and kiosk session with team B's ids, must show none of B's and change nothing of B's.

const database = (env as unknown as { SCHEDULE_DB: D1Database }).SCHEDULE_DB;
const TABLES = [
  "schedules",
  "schedule_days",
  "schedule_periods",
  "roles",
  "schedule_attendees",
  "assignments",
  "notifications_sent",
  "schedule_editors",
  "friends",
];

async function seed(team: TeamUsers): Promise<Seeded> {
  const tag = crypto.randomUUID().slice(0, 8);
  const now = Math.floor(Date.now() / 1000);
  const run = (query: string, ...values: unknown[]) =>
    database
      .prepare(query)
      .bind(...values)
      .first<{ id: number }>();
  const schedule = await run(
    "INSERT INTO schedules (team_id, name, time_zone, published_at, created_by, created_at, updated_at) VALUES (?, ?, 'America/Chicago', ?, ?, ?, ?) RETURNING id",
    team.teamId,
    `Regional ${tag}`,
    now,
    team.mentor.id,
    now,
    now,
  );
  const id = schedule?.id;
  await run(
    "INSERT INTO schedule_days (team_id, schedule_id, day, start_slot, end_slot) VALUES (?, ?, '2027-03-12', 32, 72)",
    team.teamId,
    id,
  );
  const period = await run(
    "INSERT INTO schedule_periods (team_id, schedule_id, day, start_slot, end_slot, label) VALUES (?, ?, '2027-03-12', 48, 53, ?) RETURNING id",
    team.teamId,
    id,
    `Lunch ${tag}`,
  );
  const role = await run(
    "INSERT INTO roles (team_id, name, color, created_at) VALUES (?, ?, 'blue', ?) RETURNING id",
    team.teamId,
    `Pit ${tag}`,
    now,
  );
  await run(
    "INSERT INTO schedule_attendees (team_id, schedule_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?, ?)",
    team.teamId,
    id,
    team.student.id,
    team.mentor.id,
    now,
  );
  for (const slot of [40, 41, 42]) {
    await run(
      "INSERT INTO assignments (team_id, schedule_id, user_id, day, slot, role_id) VALUES (?, ?, ?, '2027-03-12', ?, ?)",
      team.teamId,
      id,
      team.student.id,
      slot,
      role?.id,
    );
  }
  await run(
    "INSERT INTO notifications_sent (team_id, schedule_id, user_id, day, slot, sent_at) VALUES (?, ?, ?, '2027-03-12', 40, ?)",
    team.teamId,
    id,
    team.student.id,
    now,
  );
  await run(
    "INSERT INTO schedule_editors (team_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)",
    team.teamId,
    team.otherStudent.id,
    team.mentor.id,
    now,
  );
  await run(
    "INSERT INTO friends (team_id, user_id, friend_id, added_at) VALUES (?, ?, ?, ?)",
    team.teamId,
    team.student.id,
    team.otherStudent.id,
    now,
  );
  return {
    params: {
      id: String(id),
      day: "2027-03-12",
      periodId: String(period?.id),
      roleId: String(role?.id),
      userId: team.student.id,
    },
    markers: [`Regional ${tag}`, `Lunch ${tag}`, `Pit ${tag}`],
    data: { roleId: role?.id, studentId: team.student.id },
  };
}

async function snapshot(teamId: string) {
  const rows: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const { results } = await database
      .prepare(`SELECT * FROM ${table} WHERE team_id = ? ORDER BY rowid`)
      .bind(teamId)
      .all();
    rows[table] = results;
  }
  return rows;
}

it("keeps every team's schedules to itself", async () => {
  const { problems, requests } = await checkIsolation({
    app,
    seed,
    snapshot,
    // Team B's ids in bodies that would pass every check but the team's.
    bodies: (b) => {
      const d = b.data as { roleId: number; studentId: string };
      const blocks = { day: "2027-03-12", start: 40, end: 44 };
      return {
        "POST /schedules": { name: "Mine", timeZone: "America/Chicago" },
        "PATCH /schedules/:id": { name: "Mine", published: false, notifyMinutes: null },
        "PUT /schedules/:id/days/:day": { start: 36, end: 60 },
        "POST /schedules/:id/periods": { ...blocks, label: "Mine" },
        "PATCH /schedules/:id/periods/:periodId": { label: "Mine", start: 56, end: 60 },
        "POST /schedules/:id/attendees": { userIds: [d.studentId] },
        "PUT /schedules/:id/assignments": {
          changes: [{ ...blocks, userIds: [d.studentId], roleId: d.roleId }],
        },
        "POST /roles": { name: "Mine", color: "blue" },
        "PATCH /roles/:roleId": { name: "Mine", archived: true },
        "PUT /roles/order": { ids: [d.roleId] },
      };
    },
  });
  expect(problems).toEqual([]);
  expect(requests).toBeGreaterThan(80);
});

it("deletes a team's data when an operator deletes the team, and only that team's", async () => {
  const problems = await checkTeamDeletion({
    seed,
    snapshot,
    // As the platform calls it, over the service binding (the gateway never answers /internal).
    remove: (teamId) => call(`/internal/teams/${teamId}`, { method: "DELETE" }),
  });
  expect(problems).toEqual([]);
});

it("exports a team's data for its admins, and only that team's", async () => {
  const problems = await checkTeamExport({
    seed,
    // As the platform calls it when an admin downloads the app's data.
    exportOf: (teamId) => call(`/internal/teams/${teamId}/export`),
  });
  expect(problems).toEqual([]);
});
