-- Units: what an entry's quantity counts ("ft", "kg", "sheet"). Empty means one of each, so every
-- entry that was here before stays as it was. Quantities stay whole numbers in every unit.
ALTER TABLE items ADD COLUMN unit TEXT NOT NULL DEFAULT '';

-- The team's own units, offered when a unit is typed (with the common ones). Made on the Admin
-- page or loaded from a setup file, like robots and subsystems.
CREATE TABLE units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX units_team_idx ON units (team_id);
