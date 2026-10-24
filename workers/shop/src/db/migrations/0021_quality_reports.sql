-- Quality reports: with the team's quality reports on, a Quality Control step is finished by a
-- report (four checks, the steps a problem likely came from, notes), not by Mark Complete. A
-- failed report then sends the part back, or leaves it where it is.
--
-- A report keeps what it was about as it was then: the part's name, number, revision and instance,
-- the step's name, and who finished each suspect step and when. So it has no foreign keys, and
-- outlives obsolete instances deleted from the Admin page.
CREATE TABLE quality_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  part_instance_id INTEGER NOT NULL,
  part_definition_id INTEGER NOT NULL,
  part_name TEXT NOT NULL,
  part_number TEXT NOT NULL,
  revision TEXT,
  instance_number INTEGER NOT NULL,
  process_id INTEGER NOT NULL,
  process_name TEXT NOT NULL,
  reported_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  dimensions_ok INTEGER NOT NULL,
  thickness_ok INTEGER NOT NULL,
  positions_ok INTEGER NOT NULL,
  sizes_ok INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  -- The reporter couldn't tell which step it came from (alone or with suspects).
  unsure INTEGER NOT NULL DEFAULT 0,
  -- JSON: [{ processId, name, completedAt, completedBy }] for each step picked as the likely cause.
  suspects TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'sent_back', 'not_sent_back')),
  sent_back_process_id INTEGER,
  sent_back_process_name TEXT,
  sent_back_status TEXT CHECK (sent_back_status IN ('todo', 'doing')),
  outcome_by TEXT,
  outcome_at INTEGER
);
CREATE INDEX quality_reports_team_idx ON quality_reports (team_id, created_at);
