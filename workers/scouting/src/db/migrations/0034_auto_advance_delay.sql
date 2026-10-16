ALTER TABLE strategy_event_config
ADD COLUMN auto_advance_delay_minutes INTEGER NOT NULL DEFAULT 2
CHECK (auto_advance_delay_minutes BETWEEN 0 AND 30 AND auto_advance_delay_minutes = CAST(auto_advance_delay_minutes AS INTEGER));
