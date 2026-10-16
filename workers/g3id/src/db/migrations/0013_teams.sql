-- Teams (roadmap steps 2.1 and 2.2). Every account belongs to exactly one team: `team_id` on the
-- user, with no memberships table. Roles stay where they are (is_admin, is_mentor, status). A
-- team's id is its key, 'frc<number>', as team_ui_settings already uses.
-- Kiosk devices, activation codes, PINs and Slack codes carry their team too, and a PIN is now
-- unique within its team. Every existing row goes to G3's team, created here.
--
-- SQLite can't add a required foreign-key column to a table, so those tables are rebuilt: copied
-- aside, dropped, created again under the same name and filled back. D1 ignores
-- `PRAGMA foreign_keys = OFF` in a migration, so the checks are deferred to its end instead. Rows
-- must go back into a table that already has the real name: that is what clears the failures
-- dropping `core_users` leaves on the tables pointing at it (a renamed copy would not).
PRAGMA defer_foreign_keys = true;

CREATE TABLE teams (
  -- The team's key, as The Blue Alliance writes it: 'frc' and the FRC team number.
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'frc' || team_number),
  team_number INTEGER NOT NULL UNIQUE CHECK (team_number > 0),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO teams (id, team_number, name, created_at, updated_at)
VALUES ('frc1648', 1648, 'G3 Robotics', unixepoch(), unixepoch());

-- Users

-- Dropping core_users deletes its rows first, which clears team_ui_settings.updated_by
-- (ON DELETE SET NULL, migration 0012). Kept aside here and put back once the users are.
CREATE TABLE team_ui_settings_editors AS SELECT team_id, updated_by FROM team_ui_settings;

CREATE TABLE core_users_old AS SELECT * FROM core_users;
DROP TABLE core_users;

CREATE TABLE core_users (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'rejected', 'merged')),
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_mentor INTEGER NOT NULL DEFAULT 0,
  merged_into_user_id TEXT REFERENCES core_users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER,
  deleted_at INTEGER
);

INSERT INTO core_users (id, team_id, email, display_name, status, is_admin, is_mentor,
                            merged_into_user_id, created_at, updated_at, last_login_at, deleted_at)
SELECT id, 'frc1648', email, display_name, status, is_admin, is_mentor,
       merged_into_user_id, created_at, updated_at, last_login_at, deleted_at
FROM core_users_old;

DROP TABLE core_users_old;
CREATE INDEX core_users_team_id_idx ON core_users(team_id);

UPDATE team_ui_settings
SET updated_by = (SELECT updated_by FROM team_ui_settings_editors e
                  WHERE e.team_id = team_ui_settings.team_id);
DROP TABLE team_ui_settings_editors;

-- Kiosk PINs: unique within a team

CREATE TABLE core_user_pins_old AS SELECT * FROM core_user_pins;
DROP TABLE core_user_pins;

CREATE TABLE core_user_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL REFERENCES teams(id),
  user_id TEXT NOT NULL UNIQUE REFERENCES core_users(id),
  pin TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (team_id, pin)
);

INSERT INTO core_user_pins (id, team_id, user_id, pin, created_at, updated_at)
SELECT id, 'frc1648', user_id, pin, created_at, updated_at FROM core_user_pins_old;

DROP TABLE core_user_pins_old;

-- Kiosk devices and their activation codes

CREATE TABLE kiosk_devices_old AS SELECT * FROM kiosk_devices;
DROP TABLE kiosk_devices;

CREATE TABLE kiosk_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL REFERENCES teams(id),
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES core_users(id),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

INSERT INTO kiosk_devices (id, team_id, name, token, created_by, created_at, last_used_at,
                               revoked_at)
SELECT id, 'frc1648', name, token, created_by, created_at, last_used_at, revoked_at
FROM kiosk_devices_old;

DROP TABLE kiosk_devices_old;

CREATE TABLE kiosk_activation_codes_old AS SELECT * FROM kiosk_activation_codes;
DROP TABLE kiosk_activation_codes;

CREATE TABLE kiosk_activation_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL REFERENCES teams(id),
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES core_users(id),
  device_name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

INSERT INTO kiosk_activation_codes (id, team_id, code, created_by, device_name, expires_at,
                                        used, created_at)
SELECT id, 'frc1648', code, created_by, device_name, expires_at, used, created_at
FROM kiosk_activation_codes_old;

DROP TABLE kiosk_activation_codes_old;

-- Slack sign-in and link codes

CREATE TABLE core_slack_link_codes_old AS SELECT * FROM core_slack_link_codes;
DROP TABLE core_slack_link_codes;

CREATE TABLE core_slack_link_codes (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  user_id TEXT REFERENCES core_users(id),
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('signin', 'link')),
  polling_token TEXT,
  redirect_url TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'success', 'failed', 'linked', 'signup_pending')),
  status_message TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL
);

INSERT INTO core_slack_link_codes (id, team_id, user_id, code, type, polling_token,
                                       redirect_url, expires_at, used, status, status_message,
                                       session_id, created_at)
SELECT id, 'frc1648', user_id, code, type, polling_token, redirect_url,
       expires_at, used, status, status_message, session_id, created_at
FROM core_slack_link_codes_old;

DROP TABLE core_slack_link_codes_old;
