import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** The platform's team registry (migration 0001). */
export const teams = sqliteTable("teams", {
  /** "frc" + the FRC team number. */
  id: text("id").primaryKey(),
  teamNumber: integer("team_number").notNull().unique(),
  name: text("name").notNull(),
  /** ISO 3166-1 alpha-2. */
  country: text("country").notNull(),
  status: text("status", { enum: ["pending", "active", "suspended"] }).notNull(),
  founderUserId: text("founder_user_id"),
  /** Who owns the team: its founder, until an operator hands it over (migration 0003). */
  ownerUserId: text("owner_user_id"),
  slackWorkspaceId: text("slack_workspace_id"),
  slackWorkspaceName: text("slack_workspace_name"),
  /** The Discord server, for a team that signed up with Discord instead (migration 0011). */
  discordGuildId: text("discord_guild_id"),
  discordGuildName: text("discord_guild_name"),
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
  /** No longer done (teams aren't renumbered); past log rows may have it. */
  "renumber_team",
  "transfer_owner",
  "suspend_team",
  "reactivate_team",
  "resolve_report",
  "reopen_report",
  "add_operator",
  "remove_operator",
  // Migration 0007.
  "create_notification",
  "delete_notification",
  // Migration 0013.
  "block_reporter",
  "unblock_reporter",
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

/** Which apps each team has switched on (migration 0005); the apps are src/registry.ts. */
export const teamApps = sqliteTable(
  "team_apps",
  {
    teamId: text("team_id").notNull(),
    app: text("app").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    changedAt: integer("changed_at").notNull(),
    changedBy: text("changed_by"),
    /** Switched off: when its data goes. */
    deleteAfter: integer("delete_after"),
    dataDeletedAt: integer("data_deleted_at"),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.app] })],
);

export const TEAM_ACTIONS = [
  "app_enabled",
  "app_disabled",
  "app_data_deleted",
  // Migration 0006.
  "app_exported",
  "settings_changed",
] as const;

/** A team's own log of what its admins did on its dashboard (migration 0005). */
export const teamAuditLog = sqliteTable("team_audit_log", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  /** Null for the platform itself (the daily cron). */
  userId: text("user_id"),
  action: text("action", { enum: TEAM_ACTIONS }).notNull(),
  app: text("app"),
  /** JSON. */
  details: text("details").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});

export const NOTIFICATION_TYPES = ["info", "warning", "critical"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Notifications operators write for every team (migration 0007); not delivered yet. */
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  type: text("type", { enum: NOTIFICATION_TYPES }).notNull(),
  /** A short description. */
  summary: text("summary").notNull(),
  body: text("body").notNull(),
  /** When it stops being shown (unix seconds). */
  expiresAt: integer("expires_at").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const PORTAL_AUDIENCES = ["everyone", "admins", "nobody"] as const;
export type PortalAudience = (typeof PORTAL_AUDIENCES)[number];

/** Where a team wants each type of notification (migration 0008). */
export const teamNotificationSettings = sqliteTable(
  "team_notification_settings",
  {
    teamId: text("team_id").notNull(),
    type: text("type", { enum: NOTIFICATION_TYPES }).notNull(),
    /** Who sees it on the team's home page. */
    portal: text("portal", { enum: PORTAL_AUDIENCES }).notNull(),
    /** The Slack channel's id, if any. */
    slackChannel: text("slack_channel"),
    /** JSON: G3ID user ids to DM. */
    slackUsers: text("slack_users").notNull().default("[]"),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by"),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.type] })],
);

/**
 * Visits to the public landing page per day (migration 0010): how many, and how many by someone
 * signed in. Nothing about a visitor is kept. Operators read them in the console.
 */
export const landingVisits = sqliteTable("landing_visits", {
  /** UTC day, "2026-10-16". */
  day: text("day").primaryKey(),
  visits: integer("visits").notNull().default(0),
  signedIn: integer("signed_in").notNull().default(0),
});

export const REPORT_KINDS = ["problem", "idea"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/**
 * Problems and ideas members report from any app's bar (migration 0012, src/reports.ts). Each
 * becomes a public GitHub issue; the row keeps who sent it, to tell them when it's closed.
 */
export const problemReports = sqliteTable("problem_reports", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  userId: text("user_id").notNull(),
  /** Who sent it on the public issue: a `reporters` id (migration 0013). */
  reporterId: text("reporter_id"),
  /** The sender's name on the public issue, when they chose to add it (migration 0015). */
  reporterName: text("reporter_name"),
  kind: text("kind", { enum: REPORT_KINDS }).notNull(),
  /** The member's title (migration 0014), or null to use the message's first line. */
  title: text("title"),
  message: text("message").notNull(),
  /** The page it was sent from, without its query string. */
  page: text("page").notNull(),
  /** The app's slug, from the page's address. */
  app: text("app"),
  version: text("version"),
  browser: text("browser"),
  /** The GitHub issue, once it's made. */
  issueNumber: integer("issue_number"),
  issueUrl: text("issue_url"),
  status: text("status", { enum: ["open", "fixed", "closed"] })
    .notNull()
    .default("open"),
  closedAt: integer("closed_at"),
  /** When the cron last asked GitHub about the issue. */
  checkedAt: integer("checked_at"),
  createdAt: integer("created_at").notNull(),
});

/**
 * Reporter IDs (migration 0013, src/reports.ts): the random ID that stands for a member on their
 * reports' public issues, so operators can block one without learning who it is.
 */
export const reporters = sqliteTable(
  "reporters",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    blockedAt: integer("blocked_at"),
    /** The operator who blocked them. */
    blockedBy: text("blocked_by"),
    blockReason: text("block_reason"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("reporters_user").on(t.teamId, t.userId)],
);
