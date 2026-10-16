-- The platform's team registry (roadmap step 2.7). A team is signed up on the platform's site:
-- its details, then its Slack workspace, then a code its founder sends to the Slack bot. It's
-- 'pending' until then and 'active' after; only active teams get addresses (the gateway asks).
-- G3ID keeps a copy of each team's id, number and name for its own tables.
CREATE TABLE teams (
  -- The team's key, as The Blue Alliance writes it: 'frc' and the FRC team number.
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'frc' || team_number),
  team_number INTEGER NOT NULL UNIQUE CHECK (team_number > 0),
  name TEXT NOT NULL,
  -- ISO 3166-1 alpha-2, e.g. 'US'.
  country TEXT NOT NULL CHECK (length(country) = 2),
  -- IANA time zone, e.g. 'America/New_York'.
  time_zone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'suspended')),
  -- G3ID's user who signed the team up (its first admin).
  founder_user_id TEXT,
  slack_workspace_id TEXT,
  slack_workspace_name TEXT,
  terms_accepted_at INTEGER,
  -- While signing up: the sign-up's secret id (in the page's URL), and the token for the
  -- founder's code in G3ID.
  signup_id TEXT UNIQUE,
  signup_code_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- G3, the platform's first team, from before sign-ups existed.
INSERT INTO teams (id, team_number, name, country, time_zone, status, created_at, updated_at)
VALUES ('frc1648', 1648, 'G3 Robotics', 'US', 'America/New_York', 'active', unixepoch(),
        unixepoch());
