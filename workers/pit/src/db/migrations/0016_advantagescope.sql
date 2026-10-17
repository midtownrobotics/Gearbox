-- AdvantageScope Lite, served by Pit at /scope/ (src/advantagescope.ts). Its preferences and layout
-- are the team's, not one browser's: each value it would keep in localStorage is a row here, by
-- its localStorage key. Assets (fields, robots, joysticks) the team uploads are in the LOGS R2
-- bucket under pit/teams/<team>/scope-assets/<name>/, one row per asset with its files and its
-- config.json, which AdvantageScope's asset list carries.

CREATE TABLE scope_settings (
  team_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, key)
);

CREATE TABLE scope_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- JSON: [{ "name": "model.glb", "size": 123 }], the files in R2.
  files TEXT NOT NULL,
  -- JSON: the asset's config.json.
  config TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX scope_assets_name_idx ON scope_assets (team_id, name);
