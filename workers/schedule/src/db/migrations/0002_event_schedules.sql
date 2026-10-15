-- Event schedules: an event's days and labeled periods, who's attending, and each attendee's
-- role for every 15-minute block. Replaces 0001's placeholder `events`, which never held data.
--
-- Times are wall-clock slots: a local date ('2027-03-12') and a slot of that day, slot n being
-- n × 15 minutes after midnight (0–96). A range starts at its first slot and ends before its
-- last, so Lunch 12:00–1:15 is 48–53. The schedule's time zone is only needed to know "now".
--
-- Everything here is one team's data (team_id), and every query goes through inTeam/withTeam.

DROP TABLE events;

-- One event's schedule. Students and Slack see it only once it's published.
CREATE TABLE schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- IANA zone of the event ("America/Chicago").
  time_zone TEXT NOT NULL,
  -- How long before someone's role changes they get a Slack DM; null for none.
  notify_minutes INTEGER DEFAULT 5 CHECK (notify_minutes IS NULL OR notify_minutes BETWEEN 0 AND 120),
  -- Unix seconds; null while it's a draft.
  published_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX schedules_team_idx ON schedules(team_id);

-- The hours the event runs each day: the edges of the grid.
CREATE TABLE schedule_days (
  team_id TEXT NOT NULL,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  start_slot INTEGER NOT NULL CHECK (start_slot BETWEEN 0 AND 95),
  end_slot INTEGER NOT NULL CHECK (end_slot BETWEEN 1 AND 96),
  CHECK (start_slot < end_slot),
  PRIMARY KEY (schedule_id, day)
);

-- The event's labeled agenda (Load in 8:00–9:30, Lunch 12:00–1:15). Periods don't overlap
-- (checked in code), and each lies within its day's hours.
CREATE TABLE schedule_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  schedule_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  start_slot INTEGER NOT NULL CHECK (start_slot BETWEEN 0 AND 95),
  end_slot INTEGER NOT NULL CHECK (end_slot BETWEEN 1 AND 96),
  label TEXT NOT NULL,
  CHECK (start_slot < end_slot),
  FOREIGN KEY (schedule_id, day) REFERENCES schedule_days(schedule_id, day) ON DELETE CASCADE
);
CREATE INDEX schedule_periods_day_idx ON schedule_periods(schedule_id, day, start_slot);

-- The team's own roles (Drive Team, Scouting, Pit, Break, Lunch), kept from event to event.
-- A role in use is archived, not deleted.
CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- A preset key from the page's palette (drawn to suit light and dark mode), or #rrggbb.
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX roles_team_idx ON roles(team_id);

-- Who's going: the grid's rows. G3ID user ids.
CREATE TABLE schedule_attendees (
  team_id TEXT NOT NULL,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (schedule_id, user_id)
);

-- An attendee's role for one 15-minute block. No row: nothing assigned. Removing an attendee or
-- a day removes their blocks.
CREATE TABLE assignments (
  team_id TEXT NOT NULL,
  schedule_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 95),
  role_id INTEGER NOT NULL REFERENCES roles(id),
  PRIMARY KEY (schedule_id, user_id, day, slot),
  FOREIGN KEY (schedule_id, user_id) REFERENCES schedule_attendees(schedule_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (schedule_id, day) REFERENCES schedule_days(schedule_id, day) ON DELETE CASCADE
);
-- Who is where at a moment: the grid's columns and the Slack check.
CREATE INDEX assignments_slot_idx ON assignments(schedule_id, day, slot);

-- Slack DMs already sent for a role change at a block, so a repeated cron run sends none twice.
CREATE TABLE notifications_sent (
  team_id TEXT NOT NULL,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  slot INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (schedule_id, user_id, day, slot)
);

-- Members trusted to edit schedules in this app (besides ID's mentors and admins). Mentors and
-- admins choose them on Schedule's Admin page.
CREATE TABLE schedule_editors (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
