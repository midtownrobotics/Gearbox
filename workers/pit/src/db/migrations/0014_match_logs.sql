-- Match logs: AdvantageKit .wpilog files a paired log downloader uploaded, kept in the LOGS R2
-- bucket (Shop's) under pit/teams/<team>/logs/<event>/<name>.wpilog. A row is `uploading` while its parts
-- arrive (R2 multipart, `upload_id`), then `stored`. One per team, event and name: uploading it
-- again replaces it.

CREATE TABLE match_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  event TEXT NOT NULL,
  name TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('q', 'e', 'p')),
  match_number INTEGER NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploading', 'stored')),
  upload_id TEXT,
  downloader_id INTEGER,
  downloader_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  uploaded_at INTEGER
);
CREATE UNIQUE INDEX match_logs_name_idx ON match_logs (team_id, event, name);
