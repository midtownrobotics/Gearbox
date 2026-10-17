-- How long after a match moves on a scout can still send its report, and which reports came in late.
ALTER TABLE strategy_event_config
ADD COLUMN late_window_seconds INTEGER NOT NULL DEFAULT 600
CHECK (late_window_seconds BETWEEN 0 AND 3600 AND late_window_seconds = CAST(late_window_seconds AS INTEGER));

ALTER TABLE scouting_form_submissions
ADD COLUMN submitted_late INTEGER NOT NULL DEFAULT 0 CHECK (submitted_late IN (0, 1));
