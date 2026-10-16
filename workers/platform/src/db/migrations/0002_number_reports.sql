-- Reports that a team number was signed up by someone who isn't that team (from the platform's
-- /report page). Operators follow up by email; the operator console (roadmap 2.8) will list them.
CREATE TABLE number_reports (
  id TEXT PRIMARY KEY NOT NULL,
  team_number INTEGER NOT NULL CHECK (team_number > 0),
  email TEXT NOT NULL,
  name TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at INTEGER NOT NULL
);
CREATE INDEX number_reports_team_number_idx ON number_reports(team_number);
