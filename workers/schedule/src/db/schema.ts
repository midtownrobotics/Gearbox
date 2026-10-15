import { foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// All of this is one team's data, and every table carries the team: every query goes through
// inTeam/withTeam from @g3/auth (roadmap Phase 3).
//
// Times are wall-clock slots (migration 0002): a local date ("2027-03-12") and a slot of that
// day, slot n being n × 15 minutes after midnight. A range starts at its first slot and ends
// before its last (Lunch 12:00–1:15 is 48–53). See lib/slots.ts.

/** One event's schedule. Students and Slack see it only once it's published. */
export const schedules = sqliteTable(
  "schedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    /** IANA zone of the event ("America/Chicago"), for "now" and Slack. */
    timeZone: text("time_zone").notNull(),
    /** Minutes before a role change to DM the person; null for none. */
    notifyMinutes: integer("notify_minutes").default(5),
    /** Unix seconds; null while it's a draft. */
    publishedAt: integer("published_at"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("schedules_team_idx").on(t.teamId)],
);

/** The hours the event runs each day: the edges of the grid. */
export const scheduleDays = sqliteTable(
  "schedule_days",
  {
    teamId: text("team_id").notNull(),
    scheduleId: integer("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    startSlot: integer("start_slot").notNull(),
    endSlot: integer("end_slot").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scheduleId, t.day] })],
);

/** The event's labeled agenda: Load in 8:00–9:30, Lunch 12:00–1:15. Periods don't overlap. */
export const schedulePeriods = sqliteTable(
  "schedule_periods",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: text("team_id").notNull(),
    scheduleId: integer("schedule_id").notNull(),
    day: text("day").notNull(),
    startSlot: integer("start_slot").notNull(),
    endSlot: integer("end_slot").notNull(),
    label: text("label").notNull(),
  },
  (t) => [
    index("schedule_periods_day_idx").on(t.scheduleId, t.day, t.startSlot),
    foreignKey({
      columns: [t.scheduleId, t.day],
      foreignColumns: [scheduleDays.scheduleId, scheduleDays.day],
    }).onDelete("cascade"),
  ],
);

/** The team's own roles, kept from event to event. A role in use is archived, not deleted. */
export const roles = sqliteTable(
  "roles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    /** A preset key from the page's palette (drawn to suit light and dark mode), or #rrggbb. */
    color: text("color").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("roles_team_idx").on(t.teamId)],
);

/** Who's going: the grid's rows. G3ID user ids. */
export const scheduleAttendees = sqliteTable(
  "schedule_attendees",
  {
    teamId: text("team_id").notNull(),
    scheduleId: integer("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    addedBy: text("added_by").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scheduleId, t.userId] })],
);

/** An attendee's role for one 15-minute block. No row: nothing assigned. */
export const assignments = sqliteTable(
  "assignments",
  {
    teamId: text("team_id").notNull(),
    scheduleId: integer("schedule_id").notNull(),
    userId: text("user_id").notNull(),
    day: text("day").notNull(),
    slot: integer("slot").notNull(),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id),
  },
  (t) => [
    primaryKey({ columns: [t.scheduleId, t.userId, t.day, t.slot] }),
    index("assignments_slot_idx").on(t.scheduleId, t.day, t.slot),
    foreignKey({
      columns: [t.scheduleId, t.userId],
      foreignColumns: [scheduleAttendees.scheduleId, scheduleAttendees.userId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.scheduleId, t.day],
      foreignColumns: [scheduleDays.scheduleId, scheduleDays.day],
    }).onDelete("cascade"),
  ],
);

/** Slack DMs already sent for a role change at a block, so none is sent twice. */
export const notificationsSent = sqliteTable(
  "notifications_sent",
  {
    teamId: text("team_id").notNull(),
    scheduleId: integer("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    day: text("day").notNull(),
    slot: integer("slot").notNull(),
    sentAt: integer("sent_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scheduleId, t.userId, t.day, t.slot] })],
);

/** Members trusted to edit schedules in this app, besides ID's mentors and admins. */
export const scheduleEditors = sqliteTable(
  "schedule_editors",
  {
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    addedBy: text("added_by").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

/**
 * Members each person picks to see beside them on schedules. Private: only `userId` ever sees
 * their own, and the team's data download leaves them out.
 */
export const friends = sqliteTable(
  "friends",
  {
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    friendId: text("friend_id").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId, t.friendId] })],
);

/** Every team table, children before the rows they point at (for deleting a team's data). */
export const TEAM_TABLES = [
  notificationsSent,
  assignments,
  scheduleAttendees,
  schedulePeriods,
  scheduleDays,
  schedules,
  roles,
  scheduleEditors,
  friends,
] as const;

/** What the team's data download holds: everything but each person's private friends. */
export const EXPORTED_TABLES = TEAM_TABLES.filter((table) => table !== friends);
