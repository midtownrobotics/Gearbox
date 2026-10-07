-- Pit serves many teams (roadmap Phase 3). Every table carries the team. What's here is the site's
-- own team's (the only team before Phase 3), so it's filled in with that team's id, as G3ID's
-- teams migration (0013) did. SQLite can't add a NOT NULL column without a default; the app always
-- sets team_id, and the default is never left on a row.

ALTER TABLE checklist_lists ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE checklist_items ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE checklist_issues ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE batteries ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
UPDATE checklist_lists SET team_id = 'frc1648' WHERE team_id = '';
UPDATE checklist_items SET team_id = 'frc1648' WHERE team_id = '';
UPDATE checklist_issues SET team_id = 'frc1648' WHERE team_id = '';
UPDATE batteries SET team_id = 'frc1648' WHERE team_id = '';
CREATE INDEX checklist_lists_team_idx ON checklist_lists (team_id);
CREATE INDEX batteries_team_idx ON batteries (team_id);

-- Settings were keyed by name alone; now by team and name. The Blue Alliance and Nexus API keys
-- stop being settings: every team's monitor uses the worker's TBA_AUTH_KEY and NEXUS_API_KEY.
CREATE TABLE settings_new (
  team_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (team_id, key)
);
INSERT INTO settings_new (team_id, key, value)
SELECT 'frc1648', key, value FROM settings WHERE key NOT IN ('tbaAuthKey', 'nexusApiKey');
DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;
