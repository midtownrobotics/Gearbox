-- Shop serves many teams (roadmap Phase 3). Every table carries the team, and every query is kept
-- to it (inTeam/withTeam from @g3/auth). What's here is the site's own team's (the only team before
-- Phase 3), so it's filled in with that team's id, as G3ID's teams migration (0013) did. SQLite
-- can't add a NOT NULL column without a default; the app always sets team_id, and the default is
-- never left on a row.
--
-- Keys that were unique across the table are now unique within a team: setting keys, kiosk
-- devices, Onshape release ids, and an Onshape release's part numbers. Those tables are rebuilt. onshape_releases
-- is pointed at by onshape_parts, so it's copied aside, dropped, created again under the same name
-- and filled back, with the foreign-key checks deferred to the end (D1 ignores
-- `PRAGMA foreign_keys = OFF` in a migration; G3ID 0013 does the same).
--
-- Files in R2 move under teams/<team>/ (drawings, part files). Run `pnpm --filter
-- @g3/worker-shop r2:move-to-team` BEFORE this migration: it copies the objects, and this rewrites
-- the keys stored here to match (docs/deploy.md).
PRAGMA defer_foreign_keys = true;

ALTER TABLE subsystems ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE part_definitions ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE part_instances ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE processes ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE part_definition_process_blueprints ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE part_instance_processes ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE actions ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE drawings ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE files ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE part_instance_files ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE staging_batches ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
UPDATE subsystems SET team_id = 'frc1648' WHERE team_id = '';
UPDATE part_definitions SET team_id = 'frc1648' WHERE team_id = '';
UPDATE part_instances SET team_id = 'frc1648' WHERE team_id = '';
UPDATE processes SET team_id = 'frc1648' WHERE team_id = '';
UPDATE part_definition_process_blueprints SET team_id = 'frc1648' WHERE team_id = '';
UPDATE part_instance_processes SET team_id = 'frc1648' WHERE team_id = '';
UPDATE actions SET team_id = 'frc1648' WHERE team_id = '';
UPDATE drawings SET team_id = 'frc1648' WHERE team_id = '';
UPDATE files SET team_id = 'frc1648' WHERE team_id = '';
UPDATE part_instance_files SET team_id = 'frc1648' WHERE team_id = '';
UPDATE staging_batches SET team_id = 'frc1648' WHERE team_id = '';

-- The objects moved under the team's prefix (see above).
UPDATE files SET r2_key = 'teams/frc1648/' || r2_key WHERE r2_key NOT LIKE 'teams/%';
UPDATE drawings SET r2_key = 'teams/frc1648/' || r2_key WHERE r2_key NOT LIKE 'teams/%';

CREATE INDEX subsystems_team_idx ON subsystems (team_id);
CREATE INDEX part_definitions_team_idx ON part_definitions (team_id, onshape_part_number);
CREATE INDEX part_instances_team_idx ON part_instances (team_id);
CREATE INDEX processes_team_idx ON processes (team_id);
CREATE INDEX part_instance_processes_team_idx ON part_instance_processes (team_id, process_id);
CREATE INDEX actions_team_idx ON actions (team_id, created_at);
CREATE INDEX files_team_idx ON files (team_id);
CREATE INDEX staging_batches_team_idx ON staging_batches (team_id);
DROP INDEX idx_drawings_part_number;
CREATE INDEX idx_drawings_part_number ON drawings (team_id, part_number);

-- Who's at each kiosk: kiosk devices are one team's, keyed by team and device.
CREATE TABLE kiosk_presence_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  kiosk_device_id INTEGER NOT NULL,
  device_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (team_id, kiosk_device_id)
);
INSERT INTO kiosk_presence_new (team_id, kiosk_device_id, device_name, user_id, updated_at)
SELECT 'frc1648', kiosk_device_id, device_name, user_id, updated_at FROM kiosk_presence;
DROP TABLE kiosk_presence;
ALTER TABLE kiosk_presence_new RENAME TO kiosk_presence;

-- Settings: keyed by team and name. G3's Slack channels (migrations 0008, 0015) stay G3's.
CREATE TABLE admin_settings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (team_id, key)
);
INSERT INTO admin_settings_new (team_id, key, value, updated_at)
SELECT 'frc1648', key, value, updated_at FROM admin_settings;
DROP TABLE admin_settings;
ALTER TABLE admin_settings_new RENAME TO admin_settings;

-- Onshape releases and their parts: unique within a team.
CREATE TABLE onshape_releases_old AS SELECT * FROM onshape_releases;
CREATE TABLE onshape_parts_old AS SELECT * FROM onshape_parts;
DROP TABLE onshape_parts;
DROP TABLE onshape_releases;
CREATE TABLE onshape_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (team_id, release_id)
);
INSERT INTO onshape_releases (id, team_id, release_id, timestamp, created_at)
SELECT id, 'frc1648', release_id, timestamp, created_at FROM onshape_releases_old;
DROP TABLE onshape_releases_old;
CREATE TABLE onshape_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  entity_id TEXT,
  part_drawing_entity_id TEXT,
  onshape_release_id TEXT NOT NULL,
  release_id INTEGER REFERENCES onshape_releases(id),
  part_number TEXT NOT NULL,
  version_id TEXT,
  quantity INTEGER,
  created_at INTEGER NOT NULL,
  revision TEXT,
  name TEXT,
  description TEXT,
  UNIQUE (team_id, onshape_release_id, part_number)
);
INSERT INTO onshape_parts (id, team_id, entity_id, part_drawing_entity_id, onshape_release_id,
                           release_id, part_number, version_id, quantity, created_at, revision,
                           name, description)
SELECT id, 'frc1648', entity_id, part_drawing_entity_id, onshape_release_id, release_id,
       part_number, version_id, quantity, created_at, revision, name, description
FROM onshape_parts_old;
DROP TABLE onshape_parts_old;
CREATE INDEX onshape_parts_team_idx ON onshape_parts (team_id, part_number);
