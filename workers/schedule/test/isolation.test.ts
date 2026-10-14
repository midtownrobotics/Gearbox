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

// Two teams, each with an event. Every route, called as team A's admin, mentor, student and kiosk
// session with team B's ids, must show none of B's and change nothing of B's.

const database = (env as unknown as { SCHEDULE_DB: D1Database }).SCHEDULE_DB;

async function seed(team: TeamUsers): Promise<Seeded> {
  const title = `Event ${crypto.randomUUID().slice(0, 8)}`;
  const now = Math.floor(Date.now() / 1000);
  const row = await database
    .prepare(
      "INSERT INTO events (team_id, title, starts_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(team.teamId, title, now, team.mentor.id, now, now)
    .first<{ id: number }>();
  return { params: { id: String(row?.id) }, markers: [title] };
}

async function snapshot(teamId: string) {
  const { results } = await database
    .prepare("SELECT * FROM events WHERE team_id = ? ORDER BY id")
    .bind(teamId)
    .all();
  return { events: results };
}

it("keeps every team's schedule to itself", async () => {
  const { problems } = await checkIsolation({ app, seed, snapshot });
  expect(problems).toEqual([]);
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
