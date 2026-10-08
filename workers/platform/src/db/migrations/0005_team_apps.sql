-- The app library (roadmap Phase 4). The apps themselves are the manifests built into the
-- platform worker (src/registry.ts); this is which ones each team has switched on.
--
-- An app switched off is hidden at once (the gateway answers "not enabled") and its data kept
-- until `delete_after` (90 days, the privacy policy's "Data of an app your team switches off"),
-- in case the team switches it on again. Then the platform's daily cron asks the app to delete
-- the team's data and sets `data_deleted_at`. Sign-in (ID) and the team's home are always on and
-- have no rows.
CREATE TABLE team_apps (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- The app's slug: its name in site.ts.
  app TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  -- When it was last switched on or off, and by whom (a G3ID account).
  changed_at INTEGER NOT NULL,
  changed_by TEXT,
  -- Switched off: when its data goes. Null while on.
  delete_after INTEGER,
  -- Switched off and its data deleted. Null while on.
  data_deleted_at INTEGER,
  PRIMARY KEY (team_id, app)
);
CREATE INDEX team_apps_delete_after_idx ON team_apps (delete_after) WHERE delete_after IS NOT NULL;

-- Before the library, every team had every app. Teams already here keep them all switched on; a
-- team that signs up from now on starts with none. Scouting stays only the site team's
-- (its manifest's availability), whatever this says.
INSERT INTO team_apps (team_id, app, enabled, changed_at)
SELECT id, 'shop', 1, unixepoch() FROM teams WHERE status IN ('active', 'suspended');
INSERT INTO team_apps (team_id, app, enabled, changed_at)
SELECT id, 'pit', 1, unixepoch() FROM teams WHERE status IN ('active', 'suspended');
INSERT INTO team_apps (team_id, app, enabled, changed_at)
SELECT id, 'orders', 1, unixepoch() FROM teams WHERE status IN ('active', 'suspended');
INSERT INTO team_apps (team_id, app, enabled, changed_at)
SELECT id, 'edge', 1, unixepoch() FROM teams WHERE status IN ('active', 'suspended');
INSERT INTO team_apps (team_id, app, enabled, changed_at)
SELECT id, 'scouting', 1, unixepoch() FROM teams WHERE status IN ('active', 'suspended');
INSERT INTO team_apps (team_id, app, enabled, changed_at)
SELECT id, 'skillTree', 1, unixepoch() FROM teams WHERE status IN ('active', 'suspended');
INSERT INTO team_apps (team_id, app, enabled, changed_at)
SELECT id, 'attendance', 1, unixepoch() FROM teams WHERE status IN ('active', 'suspended');
INSERT INTO team_apps (team_id, app, enabled, changed_at)
SELECT id, 'inventory', 1, unixepoch() FROM teams WHERE status IN ('active', 'suspended');

-- What a team's admins did on the team's dashboard: its own log, which its admins read. Deleted
-- with the team.
CREATE TABLE team_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('app_enabled', 'app_disabled', 'app_data_deleted')),
  app TEXT,
  -- JSON.
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX team_audit_log_team_idx ON team_audit_log (team_id, created_at);
