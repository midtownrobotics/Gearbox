-- What each log downloader last said it was doing (src/downloaders.ts, POST /downloader/status):
-- JSON, { robot, rioReachable, copying, uploading, pendingUpload, version }, and when. It sends it
-- every few seconds while it's online, so a recent one means it's online.

ALTER TABLE log_downloaders ADD COLUMN status TEXT;
ALTER TABLE log_downloaders ADD COLUMN status_at INTEGER;
