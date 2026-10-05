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
  /** Who owns the team: its founder, until an operator hands it over (migration 0003). */
  ownerUserId: text("owner_user_id"),
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
  resolvedAt: integer("resolved_at"),
  resolvedBy: text("resolved_by"),
});

/** Platform operators: G3ID accounts, flagged here and not by any team role (migration 0003). */
export const operators = sqliteTable("operators", {
  userId: text("user_id").primaryKey(),
  addedBy: text("added_by"),
  createdAt: integer("created_at").notNull(),
});

export const OPERATOR_ACTIONS = [
  "view_team",
  "delete_team",
  "renumber_team",
  "transfer_owner",
  "suspend_team",
  "reactivate_team",
  "resolve_report",
  "reopen_report",
  "add_operator",
  "remove_operator",
] as const;

/** The operator access log: every action, and each look at a team's members (migration 0003). */
export const operatorActions = sqliteTable("operator_actions", {
  id: text("id").primaryKey(),
  operatorUserId: text("operator_user_id").notNull(),
  action: text("action", { enum: OPERATOR_ACTIONS }).notNull(),
  teamId: text("team_id"),
  reason: text("reason"),
  /** JSON. */
  details: text("details").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});
