import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Attendance (roadmap Phase 3): every table is one team's data and carries the team (migration
// 0002), so every query goes through inTeam/withTeam from @g3/auth.

/** Someone who has signed in at a kiosk. The id is made from their name and G3ID id. */
export const attendanceMembers = sqliteTable(
  "attendance_members",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email").notNull().default(""),
  },
  (t) => [
    index("attendance_members_user_id_idx").on(t.userId),
    index("attendance_members_team_idx").on(t.teamId),
  ],
);

export const SESSION_STATUSES = ["open", "completed", "auto-closed", "manual-adjustment"] as const;

/** A visit (sign-in to sign-out), or an admin's manual adjustment of hours. */
export const attendanceSessions = sqliteTable(
  "attendance_sessions",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    memberId: text("member_id")
      .notNull()
      .references(() => attendanceMembers.id, { onDelete: "cascade" }),
    signIn: integer("sign_in").notNull(),
    signOut: integer("sign_out"),
    durationMs: real("duration_ms"),
    adjustmentMs: real("adjustment_ms"),
    status: text("status", { enum: SESSION_STATUSES }).notNull(),
    schoolYear: text("school_year").notNull(),
    addedBy: text("added_by"),
  },
  (t) => [
    index("attendance_sessions_member_idx").on(t.memberId),
    index("attendance_sessions_team_status_idx").on(t.teamId, t.status),
  ],
);

/** Each member's hours per school year, kept up to date on every sign-out and adjustment. */
export const attendanceTotals = sqliteTable(
  "attendance_totals",
  {
    teamId: text("team_id").notNull(),
    memberId: text("member_id")
      .notNull()
      .references(() => attendanceMembers.id, { onDelete: "cascade" }),
    schoolYear: text("school_year").notNull(),
    totalMs: real("total_ms").notNull(),
    totalHours: real("total_hours").notNull(),
    sessions: integer("sessions").notNull(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.schoolYear] })],
);

/** A team's attendance settings; a team without a row gets the defaults (src/settings.ts). */
export const attendanceSettings = sqliteTable("attendance_settings", {
  teamId: text("team_id").primaryKey(),
  /** The school year starts on this month (1–12) and day. */
  schoolYearStartMonth: integer("school_year_start_month").notNull(),
  schoolYearStartDay: integer("school_year_start_day").notNull(),
  /** A session still open after this many hours is closed and doesn't count. */
  autoSignOutHours: integer("auto_sign_out_hours").notNull(),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
  updatedBy: text("updated_by"),
});
