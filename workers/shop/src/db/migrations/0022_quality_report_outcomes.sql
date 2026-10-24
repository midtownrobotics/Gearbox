-- A failed quality report now ends in one of four ways instead of two. The part can go back to
-- any step it has, not only one before the check; it can be fixed, which sends it to a step and
-- writes on the part what has to be done; it can be obsoleted and replaced with a new one; or it
-- can be left at the check for now.
--
-- SQLite can't widen a CHECK, so the table is rebuilt. Reports made before this keep their
-- outcome; the three new columns are empty for them.
ALTER TABLE quality_reports RENAME TO quality_reports_old;

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
  outcome TEXT NOT NULL CHECK (
    outcome IN ('passed', 'sent_back', 'not_sent_back', 'fixed', 'replaced')
  ),
  -- The step the part went to, for 'sent_back' and 'fixed'.
  sent_back_process_id INTEGER,
  sent_back_process_name TEXT,
  sent_back_status TEXT CHECK (sent_back_status IN ('todo', 'doing')),
  -- What has to be done to fix the part, as it was written onto the part's notes ('fixed').
  fix_note TEXT,
  -- The part made to replace this one ('replaced'); the instance may later be deleted.
  replacement_instance_id INTEGER,
  replacement_instance_number INTEGER,
  outcome_by TEXT,
  outcome_at INTEGER
);

INSERT INTO quality_reports (
  id, team_id, part_instance_id, part_definition_id, part_name, part_number, revision,
  instance_number, process_id, process_name, reported_by, created_at, dimensions_ok,
  thickness_ok, positions_ok, sizes_ok, passed, unsure, suspects, notes, outcome,
  sent_back_process_id, sent_back_process_name, sent_back_status, outcome_by, outcome_at
)
SELECT
  id, team_id, part_instance_id, part_definition_id, part_name, part_number, revision,
  instance_number, process_id, process_name, reported_by, created_at, dimensions_ok,
  thickness_ok, positions_ok, sizes_ok, passed, unsure, suspects, notes, outcome,
  sent_back_process_id, sent_back_process_name, sent_back_status, outcome_by, outcome_at
FROM quality_reports_old;

DROP TABLE quality_reports_old;
CREATE INDEX quality_reports_team_idx ON quality_reports (team_id, created_at);
