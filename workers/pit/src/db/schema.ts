import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Every table is one team's data and carries the team (migration 0011): every query goes through
// inTeam/withTeam from @g3/auth (roadmap Phase 3).

/** A team's Pit settings by name: eventKey, nexusEventKey, iframeUrl. */
export const settings = sqliteTable(
  "settings",
  {
    teamId: text("team_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.key] })],
);

export const checklistLists = sqliteTable("checklist_lists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: integer("created_at").notNull(),
});

export const checklistItems = sqliteTable(
  "checklist_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: text("team_id").notNull(),
    listId: integer("list_id")
      .notNull()
      .references(() => checklistLists.id),
    index: integer("index").notNull(),
    type: text("type", { enum: ["item", "topic"] })
      .notNull()
      .default("item"),
    name: text("name").notNull(),
    description: text("description"),
    checked: integer("checked", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("checklist_items_list_index_idx").on(table.listId, table.index)],
);

export const batteries = sqliteTable("batteries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  state: text("state", { enum: ["Charging", "In Robot", "Idle", "Broken", "Next Up"] })
    .notNull()
    .default("Idle"),
  stateSince: integer("state_since").notNull(), // milliseconds from Date.now()
  voltage: real("voltage"),
  useCount: integer("use_count").notNull().default(0), // times put in the robot
  createdAt: integer("created_at").notNull(),
});

export const checklistIssues = sqliteTable(
  "checklist_issues",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: text("team_id").notNull(),
    itemId: integer("item_id")
      .notNull()
      .references(() => checklistItems.id),
    text: text("text").notNull(),
    createdAt: integer("created_at").notNull(),
    // Seconds; null while the issue is open. A resolved issue is kept only until the next archive
    // has recorded it (migration 0012), so every read of open issues leaves these out.
    resolvedAt: integer("resolved_at"),
  },
  (table) => [index("checklist_issues_item_created_idx").on(table.itemId, table.createdAt)],
);

/**
 * The checklists as they stood one time they were archived and reset (migration 0012): what it
 * was for, who archived it and when, and a JSON snapshot of every list, item and issue
 * (ArchiveSnapshot in ../archives.ts).
 */
export const checklistArchives = sqliteTable(
  "checklist_archives",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: text("team_id").notNull(),
    event: text("event").notNull().default(""),
    type: text("type", { enum: ["match", "practice", "other"] }).notNull(),
    details: text("details").notNull().default(""),
    archivedAt: integer("archived_at").notNull(), // seconds
    archivedBy: text("archived_by").notNull(), // G3ID user id
    archivedByName: text("archived_by_name").notNull(),
    snapshot: text("snapshot").notNull(),
  },
  (table) => [index("checklist_archives_team_idx").on(table.teamId, table.id)],
);
