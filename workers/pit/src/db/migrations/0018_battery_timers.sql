-- Battery timers that can be paused (src/battery-timers.ts): how long a battery has been in its
-- state counts only while the team's timers run. counted_ms is the time counted up to
-- counting_since; counting_since is null while the timers are paused. Every timer keeps running
-- from when its battery's state last changed.
ALTER TABLE batteries ADD COLUMN counted_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE batteries ADD COLUMN counting_since INTEGER;
UPDATE batteries SET counting_since = state_since;
