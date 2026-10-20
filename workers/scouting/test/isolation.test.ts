import { env } from "cloudflare:workers";
import { teamKey } from "@g3/site-config";
import {
  type Seeded,
  checkIsolation,
  checkTeamDeletion,
  checkTeamExport,
} from "@g3/testing/isolation";
import { type TeamUsers, asUser, newTeamId, teamUsers } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import worker, { app } from "../src/index";
import type { AppEnv } from "../src/types";
import fixtures from "./fixtures/team-rows.json";

const bindings = env as unknown as AppEnv["Bindings"];
const db = bindings.SCOUTING_DB;
// Tables added after team ownership (0033) aren't in the fixtures, which that migration's test uses.
const LATER_TABLES = [
  "scout_nudges",
  "playoff_forms",
  "playoff_sessions",
  "playoff_matches",
  "playoff_participants",
  "playoff_claims",
  "playoff_reports",
];
const tableNames = [...Object.keys(fixtures), ...LATER_TABLES];
const fixtureTables = Object.keys(fixtures);

/** A running playoff session with a started match, a scout, their slot and report; a nudge. */
async function seedPlayoffs(team: TeamUsers, marker: string) {
  const session = `playoff_sessions-${team.teamId}`;
  const now = Date.now();
  const alliances = JSON.stringify(
    [1, 2, 3, 4].map((seed) => ({ seed, teams: [`${seed}01`, `${seed}02`, `${seed}03`] })),
  );
  const fields = JSON.stringify([
    {
      id: "notes",
      label: marker,
      type: "longText",
      options: [],
      min: 0,
      max: 10,
      step: 1,
      appliesTo: "both",
    },
  ]);
  await db.batch([
    db
      .prepare(
        "INSERT INTO scout_nudges (team_id, id, user_id, nudged_by, nudged_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(team.teamId, `scout_nudges-${team.teamId}`, team.student.id, team.admin.id, now),
    db
      .prepare(
        "INSERT INTO playoff_forms (team_id, fields_json, updated_by, updated_at) VALUES (?, ?, ?, ?)",
      )
      .bind(team.teamId, fields, team.admin.id, now),
    db
      .prepare(
        `INSERT INTO playoff_sessions (team_id, id, event_name, format, status, alliances_json, current_match_id, created_by, created_at, started_at, updated_at)
         VALUES (?, ?, ?, 'double4', 'live', ?, 'M1', ?, ?, ?, ?)`,
      )
      .bind(team.teamId, session, marker, alliances, team.admin.id, now, now, now),
    db
      .prepare(
        "INSERT INTO playoff_matches (team_id, session_id, match_id, started_at) VALUES (?, ?, 'M1', ?)",
      )
      .bind(team.teamId, session, now),
    db
      .prepare(
        "INSERT INTO playoff_participants (team_id, session_id, user_id, display_name, joined_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(team.teamId, session, team.student.id, marker, now),
    db
      .prepare(
        "INSERT INTO playoff_claims (team_id, session_id, match_id, slot, user_id, display_name, claimed_at) VALUES (?, ?, 'M1', 'red:overall', ?, ?, ?)",
      )
      .bind(team.teamId, session, team.student.id, marker, now),
    db
      .prepare(
        `INSERT INTO playoff_reports (team_id, id, session_id, match_id, slot, alliance_seed, team_number, answers_json, fields_json, submitted_by, submitted_by_name, created_at, updated_at)
         VALUES (?, ?, ?, 'M1', 'red:overall', 1, '', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        team.teamId,
        `playoff_reports-${team.teamId}`,
        session,
        JSON.stringify({ notes: marker }),
        fields,
        team.student.id,
        marker,
        now,
        now,
      ),
  ]);
  return session;
}

async function snapshot(teamId: string) {
  const rows = await db.batch(
    tableNames.map((name) =>
      db.prepare(`SELECT * FROM ${name} WHERE team_id = ? ORDER BY rowid`).bind(teamId),
    ),
  );
  const files = await bindings.FIELD_MAPS.list({ prefix: `teams/${teamId}/` });
  return {
    rows: Object.fromEntries(tableNames.map((name, index) => [name, rows[index].results])),
    files: files.objects.map((file) => file.key),
  };
}

async function seed(team: TeamUsers): Promise<Seeded> {
  const marker = `private-${team.teamId}`;
  const ids = Object.fromEntries(tableNames.map((name) => [name, `${name}-${team.teamId}`]));
  const key = `teams/${team.teamId}/private.png`;
  await bindings.FIELD_MAPS.put(key, marker, { httpMetadata: { contentType: "image/png" } });
  const parents = [
    "scouting_forms",
    "robot_teams",
    "manual_events",
    "boylebucks_accounts",
    "game_parlays",
  ];
  for (const name of [...parents, ...fixtureTables.filter((name) => !parents.includes(name))]) {
    const row: Record<string, string | number | null> = {
      team_id: team.teamId,
      ...(fixtures as Record<string, Record<string, string | number>>)[name],
    };
    Object.assign(row, {
      ...(row.id !== undefined ? { id: ids[name] } : {}),
      ...(row.user_id !== undefined ? { user_id: team.student.id } : {}),
      ...(row.display_name !== undefined ? { display_name: marker } : {}),
      ...(row.created_by !== undefined ? { created_by: team.admin.id } : {}),
      ...(row.created_at !== undefined ? { created_at: Date.now() } : {}),
      ...(row.event_key !== undefined ? { event_key: "manual-shared-event" } : {}),
      ...(row.email !== undefined ? { email: team.student.email } : {}),
      ...(row.status !== undefined ? { status: "open" } : {}),
      ...(row.market !== undefined ? { market: "spread" } : {}),
      ...(row.selection !== undefined ? { selection: "red" } : {}),
    });
    for (const column of [
      "name",
      "description",
      "notes",
      "summary",
      "comment",
      "message",
      "event_name",
      "submitted_by_name",
      "user_name",
    ])
      if (column in row) row[column] = marker;
    for (const column of ["r2_key", "drawing_r2_key", "image_r2_key"])
      if (column in row) row[column] = key;
    for (const column of ["content_type", "drawing_content_type", "image_content_type"])
      if (column in row) row[column] = "image/png";
    for (const column of Object.keys(row).filter((column) => column.endsWith("_json")))
      row[column] = "[]";
    if (name === "scouting_forms")
      Object.assign(row, {
        fields_json: '[{"id":"notes","label":"Notes","type":"longText","required":false}]',
        form_kind: "pit",
        is_active: 1,
      });
    if (name === "scouting_form_submissions")
      Object.assign(row, {
        form_id: ids.scouting_forms,
        submitted_by: team.student.id,
        team_name: "123",
        archived_at: null,
        answers_json: JSON.stringify({ notes: marker }),
        drawing_fields_json: JSON.stringify({ path: { key, contentType: "image/png" } }),
      });
    if (name === "robot_images") row.robot_id = ids.robot_teams;
    if (name === "game_parlay_legs") row.parlay_id = ids.game_parlays;
    if (name === "boylebucks_accounts")
      Object.assign(row, { balance: 100, earned: 100, wagered: 0 });
    if (name === "boylebucks_ledger") row.reference_id = "shared-reference";
    if (name === "game_bets" || name === "game_parlays") row.stake = 10;
    if (name === "strategy_event_config")
      Object.assign(row, {
        id: 1,
        schedule_mode: "manual",
        tba_auth_key: `secret-tba-${team.teamId}`,
        nexus_api_key: `secret-nexus-${team.teamId}`,
      });
    if (name === "manual_events")
      Object.assign(row, { ends_at: Date.now() + 86400000, delete_after: Date.now() + 345600000 });
    if (name === "manual_matches")
      Object.assign(row, {
        match_key: "shared-qm1",
        comp_level: "qm",
        red_1: "123",
        red_2: "456",
        red_3: "789",
        blue_1: "111",
        blue_2: "222",
        blue_3: "333",
      });
    if (name === "manual_teams") Object.assign(row, { team_number: "123", team_name: marker });
    if (name === "scouting_engagement_settings")
      Object.assign(row, {
        enabled: 1,
        predictions_enabled: 0,
        combinations_enabled: 0,
        leaderboard_enabled: 1,
        points_label: marker,
      });
    if (name === "strategy_presence")
      Object.assign(row, { is_admin: 1, last_seen_at: Date.now(), current_page: "forms" });
    if (name === "strategy_announcements") row.expires_at = Date.now() + 60000;
    if (name === "manual_scan_cache")
      Object.assign(row, {
        content_hash: "same-photo",
        result_json: JSON.stringify({ private: marker }),
        expires_at: Date.now() + 60000,
      });
    if (name === "service_tickets")
      Object.assign(row, { team_name: "123", issue_type: "mechanical" });
    const columns = Object.keys(row);
    await db
      .prepare(
        `INSERT INTO ${name} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      )
      .bind(...columns.map((column) => row[column]))
      .run();
  }
  const playoffSession = await seedPlayoffs(team, marker);
  return {
    markers: [marker],
    params: (path, name) =>
      name === "matchId"
        ? "M1"
        : name === "slot"
          ? "red:overall"
          : path.includes("playoffs/sessions")
            ? playoffSession
            : name === "userId"
              ? team.student.id
              : name === "email"
                ? team.student.email
                : name === "fieldId"
                  ? "path"
                  : path.includes("scouting-forms")
                    ? ids.scouting_forms
                    : path.includes("scouting-submissions") || path.includes("analysis/reports")
                      ? ids.scouting_form_submissions
                      : path.includes("tier-lists")
                        ? ids.tier_lists
                        : path.includes("field-maps")
                          ? ids.field_maps
                          : path.includes("autos")
                            ? ids.auto_routines
                            : path.includes("service-tickets")
                              ? ids.service_tickets
                              : "1",
    data: { teamId: team.teamId, userId: team.student.id, ticketId: ids.service_tickets, key },
  };
}

describe("team isolation", () => {
  it("assigns preserved rows to the original site team even when a different team visits first", async () => {
    const preserved = teamUsers("__legacy_scouting__");
    await seed(preserved);
    const visitor = teamUsers(newTeamId());
    const freshBinding = new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const response = await worker.fetch(
      new Request("http://worker.test/scouting/me", asUser(visitor.student)),
      { ...bindings, SCOUTING_DB: freshBinding },
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    const original = await jsonAs(teamUsers(teamKey).admin, "/scouting/analysis");
    expect(JSON.stringify(original)).toContain("private-__legacy_scouting__");
    expect(JSON.stringify(await jsonAs(visitor.admin, "/scouting/analysis"))).not.toContain(
      "private-__legacy_scouting__",
    );
    for (const name of tableNames)
      expect(
        (await db.prepare(`SELECT * FROM ${name} WHERE team_id = ?`).bind(preserved.teamId).all())
          .results,
      ).toEqual([]);
  });

  it("keeps every public route private across admin, mentor, student and kiosk sessions", async () => {
    const result = await checkIsolation({
      app,
      seed,
      snapshot,
      // Health has no private data; AI extraction is covered with scoped cache/quotas separately.
      skip: [
        "GET /scouting/health",
        "POST /scouting/manual-schedule/extract",
        "POST /scouting/playoffs/alliances/scan",
      ],
      bodies: (b) => ({
        "PUT /scouting/scouting-forms/:id": {
          name: "Changed",
          fields: [{ id: "notes", label: "Notes", type: "longText" }],
        },
        "PUT /scouting/tier-lists/:id": { name: "Changed", tiers: [] },
        "PUT /scouting/service-tickets/:id": { action: "close", resolution: "Changed" },
        "PUT /scouting/analysis/reports/:id/stars": { fieldIds: ["notes"] },
        "POST /scouting/strategy-admins": { userId: b.data?.userId },
        "POST /scouting/service-helpers": { userId: b.data?.userId, skills: [] },
        "POST /scouting/field-map-publishers": { userId: b.data?.userId },
        "POST /scouting/team-comments": {
          teamName: "123",
          comment: "Changed",
          sourceTicketId: b.data?.ticketId,
        },
        "PUT /team-settings": { values: { pointsLabel: "Own points" } },
        "PUT /scouting/playoffs/setup": { eventName: "Changed", assignMode: "auto" },
        "PUT /scouting/playoffs/questions": {
          fields: [{ id: "notes", label: "Changed", type: "longText", appliesTo: "both" }],
        },
        "PUT /scouting/playoffs/matches/:matchId/claim": { slot: "red:overall" },
        "PUT /scouting/playoffs/matches/:matchId/assign": {
          slot: "red:overall",
          userId: b.data?.userId,
        },
        "PUT /scouting/playoffs/matches/:matchId/lineup": {
          red: ["101", "102"],
          blue: ["401", "402"],
        },
        "POST /scouting/playoffs/matches/:matchId/winner": { winner: "red" },
        "PUT /scouting/playoffs/finalists": { seeds: [1, 2] },
        "PUT /scouting/playoffs/matches/:matchId/reports/:slot": { answers: { notes: "Changed" } },
      }),
    });
    expect(result.requests).toBeGreaterThan(150);
    expect(result.problems).toEqual([]);
  }, 120000);

  it("exports only the requested team's data and omits provider secrets", async () => {
    expect(
      await checkTeamExport({
        seed,
        exportOf: (teamId) => call(`/internal/teams/${teamId}/export`),
        secrets: (team) => [`secret-tba-${team.data?.teamId}`, `secret-nexus-${team.data?.teamId}`],
      }),
    ).toEqual([]);
  });

  it("deletes only the requested team's rows and files and supports retries", async () => {
    expect(
      await checkTeamDeletion({
        seed,
        snapshot,
        remove: (teamId) => call(`/internal/teams/${teamId}`, { method: "DELETE" }),
      }),
    ).toEqual([]);
  });

  it("seeds isolated default forms idempotently", async () => {
    const a = teamUsers(newTeamId());
    const b = teamUsers(newTeamId());
    for (const team of [a, b, a])
      expect((await call(`/internal/teams/${team.teamId}/seed`, { method: "POST" })).status).toBe(
        200,
      );
    const forms = await jsonAs<{ forms: { id: string; fields: unknown[] }[] }>(
      a.student,
      "/scouting/scouting-forms",
    );
    expect(forms.forms).toHaveLength(2);
    expect(forms.forms.every((form) => form.fields.length === 0)).toBe(true);
    await callAs(a.admin, `/scouting/scouting-forms/${forms.forms[0].id}`, { method: "DELETE" });
    const other = await jsonAs<{ forms: { isActive: boolean }[] }>(
      b.student,
      "/scouting/scouting-forms",
    );
    expect(other.forms.every((form) => form.isActive)).toBe(true);
  });
});
