-- Email and password sign-in (lib/email-sign-in.ts): off unless a team's admins switch it on, on
-- the Sign-in page of the team's admin pages.
ALTER TABLE team_sign_in_methods ADD COLUMN email_password INTEGER NOT NULL DEFAULT 0;

-- The codes G3ID emails to check an address: adding a password, signing up and resetting a
-- password. A code is kept only as its hash, with the new password's hash until it's used. Rows
-- are deleted a day after they're made; until then they also count how many codes an address got.
CREATE TABLE email_codes (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('add-password', 'signup', 'reset')),
  email TEXT NOT NULL,
  user_id TEXT REFERENCES core_users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  password_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX email_codes_address ON email_codes (team_id, email, created_at);
CREATE INDEX email_codes_created ON email_codes (created_at);

-- How many emails G3ID sent, by UTC day, team and kind: never the address. The sending cap
-- (lib/email.ts) adds up the last 31 days, and the operators' console shows them.
CREATE TABLE email_sends (
  day TEXT NOT NULL,
  team_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, team_id, kind)
);
