-- Match logs arrive gzipped (size is the compressed size) and may be trimmed to part of the
-- match on the downloader: raw_size is the .wpilog's own size, trimmed whether it was cut.
ALTER TABLE match_logs ADD COLUMN raw_size INTEGER;
ALTER TABLE match_logs ADD COLUMN trimmed INTEGER NOT NULL DEFAULT 0;
