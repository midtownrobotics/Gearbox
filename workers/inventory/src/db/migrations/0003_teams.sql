-- Inventory serves many teams (roadmap Phase 3). Every table carries the team, and every query
-- is kept to it (inTeam/withTeam from @g3/auth). What's here is the site's own team's (the only
-- team before Phase 3), so it's filled in with that team's id, as G3ID's teams migration (0013)
-- did. SQLite can't add a NOT NULL column without a default; the app always sets team_id, and the
-- default is never left on a row. Ids are row numbers and names were only ever unique among
-- siblings, so no key needs a rebuild except the intake receipts' below.

ALTER TABLE fields ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE locations ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE robots ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE subsystems ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE item_listings ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE stock ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE item_events ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE intake_receipts ADD COLUMN team_id TEXT NOT NULL DEFAULT '';

UPDATE fields SET team_id = 'frc1648' WHERE team_id = '';
UPDATE locations SET team_id = 'frc1648' WHERE team_id = '';
UPDATE robots SET team_id = 'frc1648' WHERE team_id = '';
UPDATE subsystems SET team_id = 'frc1648' WHERE team_id = '';
UPDATE items SET team_id = 'frc1648' WHERE team_id = '';
UPDATE item_listings SET team_id = 'frc1648' WHERE team_id = '';
UPDATE stock SET team_id = 'frc1648' WHERE team_id = '';
UPDATE item_events SET team_id = 'frc1648' WHERE team_id = '';
UPDATE intake_receipts SET team_id = 'frc1648' WHERE team_id = '';

CREATE INDEX fields_team_idx ON fields (team_id);
CREATE INDEX locations_team_idx ON locations (team_id);
CREATE INDEX robots_team_idx ON robots (team_id);
CREATE INDEX subsystems_team_idx ON subsystems (team_id);
CREATE INDEX items_team_idx ON items (team_id);
CREATE INDEX stock_team_idx ON stock (team_id);
DROP INDEX item_listings_catalog_idx;
CREATE INDEX item_listings_catalog_idx ON item_listings (team_id, catalog_item_id);

-- A delivery from Orders is added once per team (its key names an Orders request).
DROP INDEX intake_receipts_source_idx;
CREATE UNIQUE INDEX intake_receipts_source_idx ON intake_receipts (team_id, source_key);
