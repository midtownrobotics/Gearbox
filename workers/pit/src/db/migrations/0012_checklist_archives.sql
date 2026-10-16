-- Checklist archives: what was checked and which issues were open each time the checklists were
-- archived and reset, with who did it and when. The snapshot is JSON holding every list and its
-- items, so a log still reads the same after the lists are edited.

CREATE TABLE checklist_archives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  event TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('match', 'practice', 'other')),
  details TEXT NOT NULL DEFAULT '',
  archived_at INTEGER NOT NULL,
  archived_by TEXT NOT NULL,
  archived_by_name TEXT NOT NULL,
  snapshot TEXT NOT NULL
);
CREATE INDEX checklist_archives_team_idx ON checklist_archives (team_id, id);

-- Resolving an issue used to delete it. It's now kept, marked resolved, until the next archive
-- has recorded it as resolved; that archive deletes it.
ALTER TABLE checklist_issues ADD COLUMN resolved_at INTEGER;
