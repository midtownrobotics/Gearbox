import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const edgeStatus = sqliteTable("edge_status", {
  id: integer("id").primaryKey(),
  agentVersion: text("agent_version").notNull(),
  agentStartedAt: integer("agent_started_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  appliedStateVersion: integer("applied_state_version").notNull().default(0),
  /** The box's public address: where its uploads come from, per Cloudflare. */
  publicIp: text("public_ip"),
  /** When publicIp last changed. */
  publicIpSince: integer("public_ip_since"),
});

export const edgeAudit = sqliteTable("edge_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  userDisplayName: text("user_display_name").notNull(),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: integer("created_at").notNull(),
});

export const netClients = sqliteTable("net_clients", {
  mac: text("mac").primaryKey(),
  hostname: text("hostname"),
  displayName: text("display_name"),
  lastIp: text("last_ip"),
  isInfrastructure: integer("is_infrastructure").notNull().default(0),
  firstSeenAt: integer("first_seen_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const netUsage = sqliteTable(
  "net_usage",
  {
    mac: text("mac").notNull(),
    ts: integer("ts").notNull(),
    dlBytes: integer("dl_bytes").notNull(),
    ulBytes: integer("ul_bytes").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ts, t.mac] })],
);

export const netUsageHourly = sqliteTable(
  "net_usage_hourly",
  {
    mac: text("mac").notNull(),
    ts: integer("ts").notNull(),
    dlBytes: integer("dl_bytes").notNull(),
    ulBytes: integer("ul_bytes").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ts, t.mac] })],
);

export const netSettings = sqliteTable("net_settings", {
  id: integer("id").primaryKey(),
  capBytes: integer("cap_bytes").notNull(),
  cycleStartDay: integer("cycle_start_day").notNull(),
  updatedAt: integer("updated_at").notNull(),
  enforce: integer("enforce").notNull().default(0),
  dnsHardening: integer("dns_hardening").notNull().default(0),
  stateVersion: integer("state_version").notNull().default(1),
});

export const netBlocklists = sqliteTable("net_blocklists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
    blocklistId: integer("blocklist_id")
      .notNull()
      .references(() => netBlocklists.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
  },
  (t) => [primaryKey({ columns: [t.blocklistId, t.domain] })],
);

export const netGrants = sqliteTable("net_grants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mac: text("mac").notNull(),
  blocklistId: integer("blocklist_id").references(() => netBlocklists.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  reason: text("reason"),
  createdBy: text("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: integer("created_at").notNull(),
  revokedAt: integer("revoked_at"),
});

// Queried with raw SQL in modules/network/sites.ts (hourly and daily are unioned).
const siteUsageColumns = {
  mac: text("mac").notNull(),
  ts: integer("ts").notNull(),
  site: text("site").notNull(),
  dlBytes: integer("dl_bytes").notNull(),
  ulBytes: integer("ul_bytes").notNull(),
};

export const netSiteUsage = sqliteTable("net_site_usage", siteUsageColumns, (t) => [
  primaryKey({ columns: [t.ts, t.mac, t.site] }),
]);

export const netSiteUsageDaily = sqliteTable("net_site_usage_daily", siteUsageColumns, (t) => [
  primaryKey({ columns: [t.ts, t.mac, t.site] }),
]);
