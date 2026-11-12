-- One batched cleanup notice per team; no filenames or member data.
CREATE TABLE storage_cleanup_notices (
 team_id TEXT PRIMARY KEY NOT NULL,
 files INTEGER NOT NULL,
 bytes INTEGER NOT NULL,
 oldest INTEGER NOT NULL,
 newest INTEGER NOT NULL,
 last_sent_at INTEGER NOT NULL
);
