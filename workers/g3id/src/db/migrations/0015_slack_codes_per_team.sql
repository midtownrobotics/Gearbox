-- Slack sign-in and link codes: unique within a team, not across the whole table. Codes are only
-- 4 digits and were never deleted, so every sign-in kept one of the 10,000 for good and new codes
-- began to collide (a server error on sign-in). The app now deletes codes a day after they expire
-- and draws again when a code is taken; this rebuild drops the old expired ones too.

CREATE TABLE core_slack_link_codes_new (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  user_id TEXT REFERENCES core_users(id),
  code TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('signin', 'link')),
  polling_token TEXT,
  redirect_url TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'success', 'failed', 'linked', 'signup_pending')),
  status_message TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (team_id, code)
);

INSERT INTO core_slack_link_codes_new (id, team_id, user_id, code, type, polling_token,
                                       redirect_url, expires_at, used, status, status_message,
                                       session_id, created_at)
SELECT id, team_id, user_id, code, type, polling_token, redirect_url, expires_at, used, status,
       status_message, session_id, created_at
FROM core_slack_link_codes
WHERE expires_at >= unixepoch() - 86400;

DROP TABLE core_slack_link_codes;
ALTER TABLE core_slack_link_codes_new RENAME TO core_slack_link_codes;
