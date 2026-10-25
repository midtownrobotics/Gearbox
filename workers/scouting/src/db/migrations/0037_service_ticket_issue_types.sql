-- A service ticket has any number of issue types: a JSON array of distinct values, empty when the
-- reporter wasn't sure. SQLite can't drop a column with a CHECK, so the table is rebuilt as in
-- 0033_team_ownership.sql, keeping its team-scoped key and indexes; each existing ticket's one type
-- becomes an array of one. The allowed values match SERVICE_ISSUE_TYPES in src/service-issues.ts.
PRAGMA defer_foreign_keys = true;
CREATE TABLE service_tickets_legacy AS SELECT * FROM service_tickets;
DROP TABLE service_tickets;
CREATE TABLE service_tickets (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  issue_types TEXT NOT NULL CHECK (json_valid(issue_types) AND json_type(issue_types) = 'array'),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'closed')),
  claimed_by TEXT,
  claimed_by_name TEXT,
  resolution TEXT,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  event_key TEXT,
  match_key TEXT,
  match_number INTEGER,
  PRIMARY KEY (team_id, id)
);
INSERT INTO service_tickets (team_id, id, team_name, issue_types, description, status, claimed_by, claimed_by_name, resolution, created_by, created_by_name, created_at, updated_at, event_key, match_key, match_number) SELECT team_id, id, team_name, json_array(issue_type), description, status, claimed_by, claimed_by_name, resolution, created_by, created_by_name, created_at, updated_at, event_key, match_key, match_number FROM service_tickets_legacy;
DROP TABLE service_tickets_legacy;
CREATE INDEX service_tickets_status_idx ON service_tickets(team_id, status, created_at DESC);
CREATE INDEX service_tickets_priority_idx
  ON service_tickets(team_id, status, created_at DESC);
CREATE INDEX service_tickets_status_updated_idx
  ON service_tickets(team_id, status, updated_at DESC);
CREATE INDEX service_tickets_event_team_idx
  ON service_tickets(team_id, event_key, team_name, updated_at DESC);
CREATE INDEX service_tickets_team_event_updated_idx
  ON service_tickets(team_id, team_name, event_key, updated_at DESC);
-- A CHECK can't look inside the array, so these refuse unknown or repeated types.
CREATE TRIGGER service_tickets_issue_types_insert
BEFORE INSERT ON service_tickets
WHEN json_valid(NEW.issue_types) AND (
  EXISTS (
    SELECT 1 FROM json_each(NEW.issue_types)
     WHERE type <> 'text' OR value NOT IN ('mechanical', 'electrical', 'programming', 'other')
  )
  OR (SELECT COUNT(*) FROM json_each(NEW.issue_types))
    <> (SELECT COUNT(DISTINCT value) FROM json_each(NEW.issue_types))
)
BEGIN
  SELECT RAISE(ABORT, 'issue types must be distinct: mechanical, electrical, programming, other');
END;
CREATE TRIGGER service_tickets_issue_types_update
BEFORE UPDATE OF issue_types ON service_tickets
WHEN json_valid(NEW.issue_types) AND (
  EXISTS (
    SELECT 1 FROM json_each(NEW.issue_types)
     WHERE type <> 'text' OR value NOT IN ('mechanical', 'electrical', 'programming', 'other')
  )
  OR (SELECT COUNT(*) FROM json_each(NEW.issue_types))
    <> (SELECT COUNT(DISTINCT value) FROM json_each(NEW.issue_types))
)
BEGIN
  SELECT RAISE(ABORT, 'issue types must be distinct: mechanical, electrical, programming, other');
END;
