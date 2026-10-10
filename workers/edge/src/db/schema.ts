import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Every table is one team's data (roadmap Phase 3, migration 0005): it has `team_id`, and every
// query on it goes through inTeam/withTeam from @g3/auth. Each team has one box.

/** The team a row belongs to ("frc<number>"). */
const teamId = () => text("team_id").notNull();

/** A team's box: the hash of its key (lib/box-key.ts). */
export const edgeBoxes = sqliteTable("edge_boxes", {
  teamId: text("team_id").primaryKey(),
  keyHash: text("key_hash").notNull(),
  /** The key's last four characters, to tell keys apart. */
  keyHint: text("key_hint").notNull(),
  createdBy: text("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** What the team's box last reported (one row per team). */
export const edgeStatus = sqliteTable("edge_status", {
  teamId: text("team_id").primaryKey(),
  agentVersion: text("agent_version").notNull(),
  agentStartedAt: integer("agent_started_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  appliedStateVersion: integer("applied_state_version").notNull().default(0),
  /** The box's public address: where its uploads come from, per Cloudflare. */
  publicIp: text("public_ip"),
  /** When publicIp last changed. */
  publicIpSince: integer("public_ip_since"),
  /** The time zone the box is set to; the team's days and cycles are counted in it. */
  timeZone: text("time_zone"),
});

export const edgeAudit = sqliteTable("edge_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  userId: text("user_id").notNull(),
  userDisplayName: text("user_display_name").notNull(),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: integer("created_at").notNull(),
});

export const netClients = sqliteTable(
  "net_clients",
  {
    teamId: teamId(),
    mac: text("mac").notNull(),
    hostname: text("hostname"),
    displayName: text("display_name"),
    lastIp: text("last_ip"),
    isInfrastructure: integer("is_infrastructure").notNull().default(0),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.mac] })],
);

const usageColumns = () => ({
  teamId: teamId(),
  mac: text("mac").notNull(),
  ts: integer("ts").notNull(),
  dlBytes: integer("dl_bytes").notNull(),
  ulBytes: integer("ul_bytes").notNull(),
});

export const netUsage = sqliteTable("net_usage", usageColumns(), (t) => [
  primaryKey({ columns: [t.teamId, t.ts, t.mac] }),
]);

export const netUsageHourly = sqliteTable("net_usage_hourly", usageColumns(), (t) => [
  primaryKey({ columns: [t.teamId, t.ts, t.mac] }),
]);

/** A team's network settings (one row per team; lib's getSettings makes it). */
export const netSettings = sqliteTable("net_settings", {
  teamId: text("team_id").primaryKey(),
  /** 0: no cap set. */
  capBytes: integer("cap_bytes").notNull(),
  cycleStartDay: integer("cycle_start_day").notNull(),
  updatedAt: integer("updated_at").notNull(),
  enforce: integer("enforce").notNull().default(0),
  dnsHardening: integer("dns_hardening").notNull().default(0),
  stateVersion: integer("state_version").notNull().default(1),
});

export const netBlocklists = sqliteTable("net_blocklists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  name: text("name").notNull(),
  action: text("action", { enum: ["block", "throttle"] }).notNull(),
  rateKbps: integer("rate_kbps"),
  enabled: integer("enabled").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const netBlocklistDomains = sqliteTable(
  "net_blocklist_domains",
  {
    teamId: teamId(),
    blocklistId: integer("blocklist_id")
      .notNull()
      .references(() => netBlocklists.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
  },
  (t) => [primaryKey({ columns: [t.blocklistId, t.domain] })],
);

export const netGrants = sqliteTable("net_grants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  mac: text("mac").notNull(),
  blocklistId: integer("blocklist_id").references(() => netBlocklists.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  reason: text("reason"),
  createdBy: text("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: integer("created_at").notNull(),
  revokedAt: integer("revoked_at"),
});

const siteUsageColumns = () => ({
  teamId: teamId(),
  mac: text("mac").notNull(),
  ts: integer("ts").notNull(),
  site: text("site").notNull(),
  dlBytes: integer("dl_bytes").notNull(),
  ulBytes: integer("ul_bytes").notNull(),
});

export const netSiteUsage = sqliteTable("net_site_usage", siteUsageColumns(), (t) => [
  primaryKey({ columns: [t.teamId, t.ts, t.mac, t.site] }),
]);

export const netSiteUsageDaily = sqliteTable("net_site_usage_daily", siteUsageColumns(), (t) => [
  primaryKey({ columns: [t.teamId, t.ts, t.mac, t.site] }),
]);
