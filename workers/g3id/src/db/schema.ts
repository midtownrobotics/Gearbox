import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/** One presentation record per team; the current deployment reads only its configured team key. */
export const teamUiSettings = sqliteTable("team_ui_settings", {
  teamId: text("team_id").primaryKey(),
  settingsJson: text("settings_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by").references(() => coreUsers.id, { onDelete: "set null" }),
});

export const coreUsers = sqliteTable(
  "core_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull(),
    isAdmin: integer("is_admin").notNull().default(0),
    isMentor: integer("is_mentor").notNull().default(0),
    mergedIntoUserId: text("merged_into_user_id").references((): AnySQLiteColumn => coreUsers.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastLoginAt: integer("last_login_at"),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    check(
      "core_users_status_check",
      sql`${table.status} IN ('pending', 'active', 'rejected', 'merged')`,
    ),
  ],
);

export const coreUserIdentities = sqliteTable(
  "core_user_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => coreUsers.id),
    provider: text("provider").notNull(),
    providerId: text("provider_id"),
    providerEmail: text("provider_email"), // email or username from provider
    passwordHash: text("password_hash"), // Argon2 hash — implementation pending
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: integer("token_expires_at"),
    tokenScopes: text("token_scopes"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "core_user_identities_provider_check",
      sql`${table.provider} IN ('local', 'google', 'slack', 'github', 'onshape', 'steam')`,
    ),
    unique("core_user_identities_provider_provider_id_uniq").on(table.provider, table.providerId),
    index("core_user_identities_user_id_idx").on(table.userId),
  ],
);

export const coreSessions = sqliteTable("core_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => coreUsers.id),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const coreSlackLinkCodes = sqliteTable(
  "core_slack_link_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => coreUsers.id), // null for signin codes
    code: text("code").notNull().unique(),
    type: text("type").notNull(),
    pollingToken: text("polling_token"),
    redirectUrl: text("redirect_url"), // where to redirect after successful auth
    expiresAt: integer("expires_at").notNull(),
    used: integer("used").notNull().default(0),
    status: text("status").notNull().default("pending"), // pending, success, failed, linked, signup_pending
    statusMessage: text("status_message"), // error message if status is 'failed'
    sessionId: text("session_id"), // session ID if status is 'success'
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check("core_slack_link_codes_type_check", sql`${table.type} IN ('signin', 'link')`),
    check(
      "core_slack_link_codes_status_check",
      sql`${table.status} IN ('pending', 'success', 'failed', 'linked', 'signup_pending')`,
    ),
  ],
);

export const coreUserPins = sqliteTable("core_user_pins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => coreUsers.id),
  pin: text("pin").notNull().unique(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const kioskDevices = sqliteTable("kiosk_devices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  token: text("token").notNull().unique(),
  createdBy: text("created_by")
    .notNull()
    .references(() => coreUsers.id),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
  revokedAt: integer("revoked_at"),
});

export const kioskActivationCodes = sqliteTable("kiosk_activation_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  createdBy: text("created_by")
    .notNull()
    .references(() => coreUsers.id),
  deviceName: text("device_name").notNull(),
  expiresAt: integer("expires_at").notNull(),
  used: integer("used").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});
