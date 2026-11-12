// SPDX-License-Identifier: AGPL-3.0-only
import { inTeam } from "@g3/auth";
import { type SeasonItem, seasonHash, seasonJSON, validSeasonYear } from "@g3/auth/season-export";
import {
  type SQL,
  and,
  count,
  eq,
  getTableColumns,
  getTableName,
  isNull,
  notExists,
  sql,
} from "drizzle-orm";
import type { AnySQLiteColumn, AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./db";
import * as s from "./db/schema";

type Row = Record<string, unknown>;
export class SeasonReviewError extends Error {}
type TeamTable = AnySQLiteTable & { teamId: AnySQLiteColumn };
type Definition = { table: TeamTable; keys: string[]; kind: string; child?: string };
// Children precede parents. Templates, permissions, keys, points balances/ledger and shared
// caches are reusable team setup/history, never season-reset targets.
export const seasonTables: Definition[] = [
  { table: s.robotImages, keys: ["id"], kind: "Robot photos", child: "robot_id" },
  {
    table: s.manualMatches,
    keys: ["event_key", "match_key"],
    kind: "Manual matches",
    child: "event_key",
  },
  {
    table: s.manualTeams,
    keys: ["event_key", "team_number"],
    kind: "Manual teams",
    child: "event_key",
  },
  { table: s.gameParlayLegs, keys: ["id"], kind: "Combined picks", child: "parlay_id" },
  { table: s.scoutingFormSubmissions, keys: ["id"], kind: "Scouting reports" },
  { table: s.autoRoutines, keys: ["id"], kind: "Auton routines" },
  { table: s.fieldMaps, keys: ["id"], kind: "Shared field maps" },
  { table: s.serviceTickets, keys: ["id"], kind: "Service tickets" },
  { table: s.teamComments, keys: ["id"], kind: "Team comments" },
  {
    table: s.scoutingMatchAssignments,
    keys: ["event_key", "match_number", "user_id"],
    kind: "Match assignments",
  },
  { table: s.gameBets, keys: ["id"], kind: "Match predictions" },
  { table: s.gameParlays, keys: ["id"], kind: "Combined predictions" },
  { table: s.robotTeams, keys: ["id"], kind: "Robot profiles" },
  { table: s.manualEvents, keys: ["event_key"], kind: "Manual events" },
  { table: s.tierLists, keys: ["id"], kind: "Tier lists" },
  { table: s.strategyAnnouncements, keys: ["id"], kind: "Announcements" },
  { table: s.strategyEventConfig, keys: ["id"], kind: "Active event" },
];
export const definition = (table: string) => {
  const result = seasonTables.find((item) => getTableName(item.table) === table);
  if (!result) throw new Error("Unknown seasonal record.");
  return result;
};
const childKey = (table: string) => {
  const key = definition(table).child;
  if (!key) throw new Error("Unknown seasonal child record.");
  return key;
};
export type SeasonRow = { table: string; data: Row };
export type SeasonRef = { table: string; key: Row; hash: string };
export type Candidate = SeasonItem & { rows: SeasonRow[] };

/** A date of upload says nothing about which game a record belongs to. */
export function eventYear(key: unknown): number | null {
  if (typeof key !== "string") return null;
  const match = /^(\d{4})[a-z][a-z0-9]*$/i.exec(key);
  const year = match ? Number(match[1]) : null;
  return validSeasonYear(year) ? year : null;
}
export async function seasonRows(db: Db, teamId: string) {
  const result: Record<string, Row[]> = {};
  let estimatedBytes = 0;
  // Sequential reads avoid a burst of D1 calls on the review page.
  for (const { table } of seasonTables) {
    const columns = Object.values(getTableColumns(table));
    const rowSize = sql.join(
      columns.map((column) => sql`coalesce(length(cast(${column} as blob)), 0)`),
      sql` + `,
    );
    const totals = await db
      .select({ count: count(), chars: sql<number>`coalesce(sum(${rowSize}), 0)` })
      .from(table)
      .where(inTeam(table, teamId))
      .get();
    // Bound full-answer reads before they enter Worker memory, including embedded NULs.
    // A conservative byte multiplier leaves room for JSON escaping and serialized keys.
    estimatedBytes += 4 * (totals?.chars ?? 0) + (totals?.count ?? 0) * columns.length * 64;
    if ((totals?.count ?? 0) > 10000 || estimatedBytes > 32 * 1024 ** 2)
      throw new SeasonReviewError(
        "This team has too much data for one season review. Contact support before resetting.",
      );
    const rows = await db.select().from(table).where(inTeam(table, teamId)).limit(10001);
    if (rows.length > 10000)
      throw new SeasonReviewError(
        "This team has too many records for one season review. Contact support before resetting.",
      );
    result[getTableName(table)] = rows;
  }
  return result;
}
export function safeSeasonRow({ table, data }: SeasonRow): SeasonRow {
  if (table !== "strategy_event_config") return { table, data };
  const { tba_auth_key: _tba, nexus_api_key: _nexus, ...safe } = data;
  return { table, data: safe };
}
export const rowKey = ({ table, data }: SeasonRow) =>
  Object.fromEntries(definition(table).keys.map((key) => [key, data[key]]));
export const refKey = (row: { table: string; key: Row }) => `${row.table}:${seasonJSON(row.key)}`;
export async function rowRef(row: SeasonRow): Promise<SeasonRef> {
  return { table: row.table, key: rowKey(row), hash: await seasonHash(safeSeasonRow(row)) };
}
export function rowFileKeys(row: SeasonRow): string[] {
  const data = row.data;
  const keys = [data.r2_key, data.image_r2_key, data.drawing_r2_key].filter(
    (key): key is string => typeof key === "string" && !!key,
  );
  if (typeof data.drawing_fields_json === "string") {
    const fields = JSON.parse(data.drawing_fields_json) as Record<string, { key?: unknown }>;
    for (const item of Object.values(fields))
      if (typeof item?.key === "string" && item.key) keys.push(item.key);
  }
  return [...new Set(keys)];
}

export function seasonCandidates(rows: Record<string, Row[]>): Candidate[] {
  const eventNames = new Map(
    rows.manual_events.map((row) => [String(row.event_key), String(row.event_name)]),
  );
  const candidates = new Map<string, Candidate>();
  for (const def of seasonTables) {
    if (def.child) continue;
    const table = getTableName(def.table);
    for (const data of rows[table]) {
      if (table === "strategy_event_config" && !data.event_key) continue;
      const row = { table, data };
      const year = eventYear(data.event_key);
      const event = typeof data.event_key === "string" && data.event_key ? data.event_key : null;
      const key = event ? `${table}:event:${event}` : refKey({ table, key: rowKey(row) });
      let candidate = candidates.get(key);
      if (!candidate) {
        const label = event
          ? eventNames.get(event) || event
          : String(data.name || data.team_name || data.message || data.id);
        candidate = {
          key,
          label: label.slice(0, 200),
          kind: def.kind,
          year,
          records: 0,
          files: 0,
          rows: [],
        };
        candidates.set(key, candidate);
      }
      candidate.rows.push(row);
      const child =
        table === "robot_teams"
          ? "robot_images"
          : table === "manual_events"
            ? "manual_matches"
            : table === "game_parlays"
              ? "game_parlay_legs"
              : null;
      if (child) {
        const fk = childKey(child);
        const parentKey = table === "manual_events" ? data.event_key : data.id;
        candidate.rows.push(
          ...rows[child]
            .filter((item) => item[fk] === parentKey)
            .map((item) => ({ table: child, data: item })),
        );
        if (table === "manual_events")
          candidate.rows.push(
            ...rows.manual_teams
              .filter((item) => item.event_key === parentKey)
              .map((item) => ({ table: "manual_teams", data: item })),
          );
      }
    }
  }
  for (const item of candidates.values()) {
    item.records = item.rows.length;
    item.files = new Set(item.rows.flatMap(rowFileKeys)).size;
  }
  return [...candidates.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label),
  );
}

export function matchRow(table: AnySQLiteTable, row: Row): SQL | undefined {
  const columns = getTableColumns(table);
  return and(
    ...Object.entries(row).map(([key, value]) =>
      value === null ? isNull(columns[key]) : eq(columns[key], value),
    ),
  );
}
/** No cascade can remove a new or changed child that wasn't in the verified backup. */
export function noRemainingChildren(table: string, teamId: string, row: Row, db: Db): SQL[] {
  const children =
    table === "robot_teams"
      ? [s.robotImages]
      : table === "manual_events"
        ? [s.manualMatches, s.manualTeams]
        : table === "game_parlays"
          ? [s.gameParlayLegs]
          : [];
  return children.map((child) => {
    const key = childKey(getTableName(child));
    return notExists(
      db
        .select({ team: child.teamId })
        .from(child)
        .where(
          inTeam(
            child,
            teamId,
            eq(
              (getTableColumns(child) as Record<string, AnySQLiteColumn>)[key],
              table === "manual_events" ? row.event_key : row.id,
            ),
          ),
        ),
    );
  });
}
