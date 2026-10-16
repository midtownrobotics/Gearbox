CREATE TABLE team_ui_settings (
  team_id TEXT PRIMARY KEY NOT NULL,
  settings_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES core_users(id) ON DELETE SET NULL
);
