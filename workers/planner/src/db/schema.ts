// SPDX-License-Identifier: AGPL-3.0-only
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// All of this is one team's data, and every table carries the team: every query goes through
// inTeam/withTeam from @g3/auth (roadmap Phase 3).

/**
 * Where a card is: Not Started, one of the team's middle columns ("in_progress", with its
 * `columnId`), or Done. Not Started and Done always stay; the middle ones are the team's own.
 */
export const STATUSES = ["not_started", "in_progress", "done"] as const;
export type Status = (typeof STATUSES)[number];

/** A middle column of the team's board, between Not Started and Done. */
export const boardColumns = sqliteTable(
  "board_columns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    /** Left to right. */
    sortOrder: integer("sort_order").notNull(),
    /** G3ID user id; null for one Gearbox made. */
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("board_columns_team_idx").on(t.teamId, t.sortOrder)],
);

/** A card on the team's board. */
export const cards = sqliteTable(
  "cards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: text("team_id").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: STATUSES }).notNull(),
    /** Its middle column while `status` is in_progress; null in Not Started and Done. */
    columnId: integer("column_id").references(() => boardColumns.id),
    /** Its place in its column, top first. Gaps are fine: only the order counts. */
    sortOrder: integer("sort_order").notNull(),
    /** When it's due, if ever: a calendar day ("2026-11-21"), the same for everyone. */
    dueDate: text("due_date"),
    /**
     * A card scheduled ahead: off the board until this day (in the viewer's time zone), then in
     * Not Started. Null once it's on the board.
     */
    startsOn: text("starts_on"),
    /** G3ID user id. */
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("cards_team_status_idx").on(t.teamId, t.status, t.sortOrder)],
);

/** Who's on each card: members add and remove themselves. Deleted with its card. */
export const cardMembers = sqliteTable(
  "card_members",
  {
    teamId: text("team_id").notNull(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** G3ID user id. */
    userId: text("user_id").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.userId] }),
    index("card_members_team_idx").on(t.teamId),
  ],
);

/** Each team's Planner settings: one row per team, made when an admin first saves them. */
export const plannerSettings = sqliteTable("planner_settings", {
  teamId: text("team_id").primaryKey(),
  /** The Slack or Discord channel meeting overviews go to. */
  overviewChannel: text("overview_channel"),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at").notNull(),
});

/** A meeting overview posted to the team's chat. Only the team's latest is kept up to date. */
export const overviews = sqliteTable(
  "overviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: text("team_id").notNull(),
    provider: text("provider", { enum: ["slack", "discord"] }).notNull(),
    channel: text("channel").notNull(),
    messageId: text("message_id").notNull(),
    /** What it says now: an edit is only sent when the text changes. */
    lastText: text("last_text").notNull(),
    postedBy: text("posted_by").notNull(),
    postedAt: integer("posted_at").notNull(),
    /** The sender's time zone (IANA, from their browser), for the date in the heading. */
    timeZone: text("time_zone").notNull().default("UTC"),
  },
  (t) => [index("overviews_team_idx").on(t.teamId, t.id)],
);

/** The cards that have been on an overview, and where, so one finished since shows crossed off. */
export const overviewCards = sqliteTable(
  "overview_cards",
  {
    teamId: text("team_id").notNull(),
    overviewId: integer("overview_id")
      .notNull()
      .references(() => overviews.id, { onDelete: "cascade" }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** The list it was last in on the overview: a finished card stays there, crossed off. */
    section: text("section", { enum: ["not_started", "in_progress"] })
      .notNull()
      .default("not_started"),
  },
  (t) => [
    primaryKey({ columns: [t.overviewId, t.cardId] }),
    index("overview_cards_team_idx").on(t.teamId),
  ],
);

/** Every team table, children first: what deleting or moving a team goes through. */
/** Students trusted to put anyone on a card or take them off, besides mentors and admins. */
export const trustedStudents = sqliteTable(
  "trusted_students",
  {
    teamId: text("team_id").notNull(),
    /** G3ID user id. */
    userId: text("user_id").notNull(),
    /** G3ID user id of the mentor or admin who added them. */
    addedBy: text("added_by").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const TEAM_TABLES = [
  trustedStudents,
  overviewCards,
  overviews,
  plannerSettings,
  cardMembers,
  cards,
  boardColumns,
] as const;
