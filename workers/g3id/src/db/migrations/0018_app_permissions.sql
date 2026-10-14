CREATE UNIQUE INDEX core_users_team_id_id_uniq ON core_users(team_id, id);
CREATE TABLE app_permissions (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  app TEXT NOT NULL,
  trusted_student INTEGER NOT NULL CHECK (trusted_student IN (0, 1)),
  mentor_access INTEGER NOT NULL CHECK (mentor_access IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES core_users(id) ON DELETE SET NULL,
  PRIMARY KEY (team_id, user_id, app),
  FOREIGN KEY (team_id, user_id) REFERENCES core_users(team_id, id) ON DELETE CASCADE ON UPDATE CASCADE
);
