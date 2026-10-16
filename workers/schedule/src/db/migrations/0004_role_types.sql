-- A role's type: what kind of work it is at an event. Every role starts as other.
ALTER TABLE roles ADD COLUMN type TEXT NOT NULL DEFAULT 'other'
  CHECK (type IN ('scouting', 'pit', 'other'));
