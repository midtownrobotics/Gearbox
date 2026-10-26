-- Every call Shop makes to Onshape's API, counted per team, per day (UTC) and per kind of call
-- (lib/onshape-api.ts), so admins can see how much of Onshape's API allowance Shop uses and what
-- uses it. The last success and error times tell the pages whether Onshape is answering now.
-- Each call carries which API key made it, so a team that switches keys can see the new keys' use
-- on its own.
CREATE TABLE onshape_api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  -- The start of the SHA-256 of the API access key (keyId): never the key itself.
  key_id TEXT NOT NULL,
  -- YYYY-MM-DD, UTC.
  day TEXT NOT NULL,
  -- What the call was for: 'release_package', 'bom', 'drawing_export', ... (ONSHAPE_CALLS).
  kind TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  -- When (Unix milliseconds) this day's last successful call of this kind was, and its last error.
  last_ok_at INTEGER,
  last_error_at INTEGER,
  UNIQUE (team_id, key_id, day, kind)
);

-- The team's most recent failed calls (the last 50 are kept): what was asked, and what Onshape
-- answered.
CREATE TABLE onshape_api_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  -- Unix milliseconds.
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  -- The HTTP status; 0 when Onshape couldn't be reached.
  status INTEGER NOT NULL,
  message TEXT
);
CREATE INDEX onshape_api_errors_team_idx ON onshape_api_errors (team_id, at);
