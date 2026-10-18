-- Consolidate the match advance delay into one seconds-based setting.
ALTER TABLE strategy_event_config
ADD COLUMN submission_window_seconds INTEGER NOT NULL DEFAULT 120
CHECK (submission_window_seconds BETWEEN 0 AND 1800 AND submission_window_seconds = CAST(submission_window_seconds AS INTEGER));

UPDATE strategy_event_config
SET submission_window_seconds = auto_advance_delay_minutes * 60;

ALTER TABLE strategy_event_config DROP COLUMN auto_advance_delay_minutes;
