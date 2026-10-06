PRAGMA foreign_keys = ON;

CREATE TABLE attendance_members (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT ''
);

CREATE INDEX attendance_members_user_id_idx ON attendance_members(user_id);

CREATE TABLE attendance_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES attendance_members(id) ON DELETE CASCADE,
  sign_in INTEGER NOT NULL,
  sign_out INTEGER,
  duration_ms REAL,
  adjustment_ms REAL,
  status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'auto-closed', 'manual-adjustment')),
  school_year TEXT NOT NULL,
  added_by TEXT
);

CREATE INDEX attendance_sessions_member_idx ON attendance_sessions(member_id);
CREATE INDEX attendance_sessions_year_idx ON attendance_sessions(school_year);
CREATE INDEX attendance_sessions_status_idx ON attendance_sessions(status);
CREATE UNIQUE INDEX attendance_one_open_session_per_member_idx
  ON attendance_sessions(member_id) WHERE status = 'open';

CREATE TABLE attendance_totals (
  member_id TEXT NOT NULL REFERENCES attendance_members(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  total_ms REAL NOT NULL,
  total_hours REAL NOT NULL,
  sessions INTEGER NOT NULL,
  PRIMARY KEY (member_id, school_year)
);
