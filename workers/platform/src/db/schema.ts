import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** The platform's team registry (migration 0001). */
export const teams = sqliteTable("teams", {
  /** "frc" + the FRC team number. */
  id: text("id").primaryKey(),
  teamNumber: integer("team_number").notNull().unique(),
  name: text("name").notNull(),
  /** ISO 3166-1 alpha-2. */
  country: text("country").notNull(),
  /** IANA time zone. */
  timeZone: text("time_zone").notNull(),
  status: text("status", { enum: ["pending", "active", "suspended"] }).notNull(),
  founderUserId: text("founder_user_id"),
  slackWorkspaceId: text("slack_workspace_id"),
  slackWorkspaceName: text("slack_workspace_name"),
  termsAcceptedAt: integer("terms_accepted_at"),
  signupId: text("signup_id").unique(),
  signupCodeToken: text("signup_code_token"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Reports that a team number was falsely registered (migration 0002). */
export const numberReports = sqliteTable("number_reports", {
  id: text("id").primaryKey(),
  teamNumber: integer("team_number").notNull(),
  email: text("email").notNull(),
  name: text("name"),
  message: text("message").notNull(),
  status: text("status", { enum: ["open", "resolved"] })
    .notNull()
    .default("open"),
  createdAt: integer("created_at").notNull(),
});
