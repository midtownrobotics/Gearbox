-- Edge serves many teams, each with its own box (roadmap Phase 3, steps E.1 and E.2). Every table
-- carries the team, and every query is kept to it (inTeam/withTeam from @g3/auth). What's here is
-- the site's own team's box (the only box before), so it's filled in with that team's id, as G3ID's
-- teams migration (0013) did.
--
-- Rebuilt, because their keys must include the team:
-- - edge_status and net_settings were one row (CHECK (id = 1)); now one row per team.
-- - net_clients by MAC; usage and site usage by (ts, MAC[, site]). Pseudo-clients like "_wan" and
--   "_lookup" are the same key on every team's box, so the team must be part of the key.
-- The others only gain the team. edge_boxes is new: each team's box and its key (hashed).
PRAGMA defer_foreign_keys = true;

CREATE TABLE edge_boxes (
  team_id TEXT PRIMARY KEY NOT NULL,
  -- SHA-256 of the box's key (hex). The key itself is shown once, when it's made.
  key_hash TEXT NOT NULL,
  -- Its last four characters, so admins can tell keys apart.
  key_hint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE edge_status_new (
  team_id TEXT PRIMARY KEY NOT NULL,
  agent_version TEXT NOT NULL,
  agent_started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  applied_state_version INTEGER NOT NULL DEFAULT 0,
  public_ip TEXT,
  public_ip_since INTEGER,
  -- The time zone the box is set to (it's in the shop); days and cycles are counted in it.
  time_zone TEXT
);
INSERT INTO edge_status_new (team_id, agent_version, agent_started_at, last_seen_at,
                             applied_state_version, public_ip, public_ip_since, time_zone)
SELECT 'frc1648', agent_version, agent_started_at, last_seen_at, applied_state_version, public_ip,
       public_ip_since, 'America/New_York'
FROM edge_status;
DROP TABLE edge_status;
ALTER TABLE edge_status_new RENAME TO edge_status;

CREATE TABLE net_settings_new (
  team_id TEXT PRIMARY KEY NOT NULL,
  -- 0: no cap set.
  cap_bytes INTEGER NOT NULL,
  cycle_start_day INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  enforce INTEGER NOT NULL DEFAULT 0,
  dns_hardening INTEGER NOT NULL DEFAULT 0,
  state_version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO net_settings_new (team_id, cap_bytes, cycle_start_day, updated_at, enforce,
                              dns_hardening, state_version)
SELECT 'frc1648', cap_bytes, cycle_start_day, updated_at, enforce, dns_hardening, state_version
FROM net_settings;
DROP TABLE net_settings;
ALTER TABLE net_settings_new RENAME TO net_settings;

CREATE TABLE net_clients_new (
  team_id TEXT NOT NULL,
  mac TEXT NOT NULL,
  hostname TEXT,
  display_name TEXT,
  last_ip TEXT,
  is_infrastructure INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, mac)
);
INSERT INTO net_clients_new (team_id, mac, hostname, display_name, last_ip, is_infrastructure,
                             first_seen_at, last_seen_at)
SELECT 'frc1648', mac, hostname, display_name, last_ip, is_infrastructure, first_seen_at,
       last_seen_at
FROM net_clients;
DROP TABLE net_clients;
ALTER TABLE net_clients_new RENAME TO net_clients;

CREATE TABLE net_usage_new (
  team_id TEXT NOT NULL,
  mac TEXT NOT NULL,
  ts INTEGER NOT NULL,
  dl_bytes INTEGER NOT NULL,
  ul_bytes INTEGER NOT NULL,
  PRIMARY KEY (team_id, ts, mac)
);
INSERT INTO net_usage_new (team_id, mac, ts, dl_bytes, ul_bytes)
SELECT 'frc1648', mac, ts, dl_bytes, ul_bytes FROM net_usage;
DROP TABLE net_usage;
ALTER TABLE net_usage_new RENAME TO net_usage;
CREATE INDEX idx_net_usage_mac_ts ON net_usage (team_id, mac, ts);

CREATE TABLE net_usage_hourly_new (
  team_id TEXT NOT NULL,
  mac TEXT NOT NULL,
  ts INTEGER NOT NULL,
  dl_bytes INTEGER NOT NULL,
  ul_bytes INTEGER NOT NULL,
  PRIMARY KEY (team_id, ts, mac)
);
INSERT INTO net_usage_hourly_new (team_id, mac, ts, dl_bytes, ul_bytes)
SELECT 'frc1648', mac, ts, dl_bytes, ul_bytes FROM net_usage_hourly;
DROP TABLE net_usage_hourly;
ALTER TABLE net_usage_hourly_new RENAME TO net_usage_hourly;
CREATE INDEX idx_net_usage_hourly_mac_ts ON net_usage_hourly (team_id, mac, ts);

CREATE TABLE net_site_usage_new (
  team_id TEXT NOT NULL,
  mac TEXT NOT NULL,
  ts INTEGER NOT NULL,
  site TEXT NOT NULL,
  dl_bytes INTEGER NOT NULL,
  ul_bytes INTEGER NOT NULL,
  PRIMARY KEY (team_id, ts, mac, site)
);
INSERT INTO net_site_usage_new (team_id, mac, ts, site, dl_bytes, ul_bytes)
SELECT 'frc1648', mac, ts, site, dl_bytes, ul_bytes FROM net_site_usage;
DROP TABLE net_site_usage;
ALTER TABLE net_site_usage_new RENAME TO net_site_usage;
CREATE INDEX idx_net_site_usage_site_ts ON net_site_usage (team_id, site, ts);
CREATE INDEX idx_net_site_usage_mac_ts ON net_site_usage (team_id, mac, ts);

CREATE TABLE net_site_usage_daily_new (
  team_id TEXT NOT NULL,
  mac TEXT NOT NULL,
  ts INTEGER NOT NULL,
  site TEXT NOT NULL,
  dl_bytes INTEGER NOT NULL,
  ul_bytes INTEGER NOT NULL,
  PRIMARY KEY (team_id, ts, mac, site)
);
INSERT INTO net_site_usage_daily_new (team_id, mac, ts, site, dl_bytes, ul_bytes)
SELECT 'frc1648', mac, ts, site, dl_bytes, ul_bytes FROM net_site_usage_daily;
DROP TABLE net_site_usage_daily;
ALTER TABLE net_site_usage_daily_new RENAME TO net_site_usage_daily;
CREATE INDEX idx_net_site_usage_daily_site_ts ON net_site_usage_daily (team_id, site, ts);
CREATE INDEX idx_net_site_usage_daily_mac_ts ON net_site_usage_daily (team_id, mac, ts);

ALTER TABLE edge_audit ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE net_blocklists ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE net_blocklist_domains ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE net_grants ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
UPDATE edge_audit SET team_id = 'frc1648' WHERE team_id = '';
UPDATE net_blocklists SET team_id = 'frc1648' WHERE team_id = '';
UPDATE net_blocklist_domains SET team_id = 'frc1648' WHERE team_id = '';
UPDATE net_grants SET team_id = 'frc1648' WHERE team_id = '';
CREATE INDEX edge_audit_team_idx ON edge_audit (team_id, created_at);
CREATE INDEX net_blocklists_team_idx ON net_blocklists (team_id);
CREATE INDEX net_grants_team_idx ON net_grants (team_id, expires_at);
