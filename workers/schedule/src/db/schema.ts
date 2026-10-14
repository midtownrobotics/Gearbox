import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// All of this is one team's data, and every table carries the team: every query goes through
// inTeam/withTeam from @g3/auth (roadmap Phase 3).

/** One thing on the team's calendar. Times are Unix seconds; no end is a moment (a deadline). */
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: text("team_id").notNull(),
    title: text("title").notNull(),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at"),
    /** G3ID user id. */
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("events_team_starts_idx").on(t.teamId, t.startsAt)],
);
