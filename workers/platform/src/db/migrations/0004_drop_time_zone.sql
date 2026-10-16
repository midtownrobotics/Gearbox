-- Teams no longer give a time zone when they sign up: nothing used it.
ALTER TABLE teams DROP COLUMN time_zone;
