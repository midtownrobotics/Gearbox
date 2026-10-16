-- A title for a location: a few words on what's kept there, shown beside its name everywhere
-- ("A1 - Misc. Electronics"), so people can tell what belongs where. Empty for none.
ALTER TABLE locations ADD COLUMN title TEXT NOT NULL DEFAULT '';
