-- How long a finished match stays the current one, so scouts can still submit its form.
ALTER TABLE strategy_event_config ADD COLUMN submission_window_seconds INTEGER NOT NULL DEFAULT 60;
