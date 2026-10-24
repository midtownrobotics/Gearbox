-- The checklist a quality report goes through is the team's own, edited by admins on the Admin
-- page, instead of the four questions built into the app. A team that hasn't set one gets those
-- four the first time it needs them (lib/quality-checklist.ts), so no team's list is in a
-- migration.
CREATE TABLE quality_check_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  label TEXT NOT NULL,
  -- Where it sits in the list, from 0.
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX quality_check_items_team_idx ON quality_check_items (team_id, position);

-- A report now keeps the list it was answered against, as it read then: a JSON array of
-- [{ label, ok }] in the team's order. The four fixed columns become the first four entries.
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
  -- JSON: [{ label, ok }] for each item of the checklist as it read when the report was written.
  checks TEXT NOT NULL DEFAULT '[]',
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
  instance_number, process_id, process_name, reported_by, created_at, checks, passed, unsure,
  suspects, notes, outcome, sent_back_process_id, sent_back_process_name, sent_back_status,
  fix_note, replacement_instance_id, replacement_instance_number, outcome_by, outcome_at
)
SELECT
  id, team_id, part_instance_id, part_definition_id, part_name, part_number, revision,
  instance_number, process_id, process_name, reported_by, created_at,
  json_array(
    json_object('label', 'Part has the proper dimensions', 'ok', json(
      CASE dimensions_ok WHEN 0 THEN 'false' ELSE 'true' END)),
    json_object('label', 'Part is the proper thickness', 'ok', json(
      CASE thickness_ok WHEN 0 THEN 'false' ELSE 'true' END)),
    json_object('label', 'Features are positioned correctly', 'ok', json(
      CASE positions_ok WHEN 0 THEN 'false' ELSE 'true' END)),
    json_object('label', 'Features are the proper size', 'ok', json(
      CASE sizes_ok WHEN 0 THEN 'false' ELSE 'true' END))
  ),
  passed, unsure, suspects, notes, outcome, sent_back_process_id, sent_back_process_name,
  sent_back_status, fix_note, replacement_instance_id, replacement_instance_number,
  outcome_by, outcome_at
FROM quality_reports_old;

DROP TABLE quality_reports_old;
CREATE INDEX quality_reports_team_idx ON quality_reports (team_id, created_at);
