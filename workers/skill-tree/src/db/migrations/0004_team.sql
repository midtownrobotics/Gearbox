-- Skill Tree serves many teams (roadmap Phase 3). tree_sets is the one table that carries the team;
-- everything else hangs off a set. The set that's here is the site's own team's (the only team
-- before Phase 3), so it's filled in with that team's id, as G3ID's teams migration (0013) did.
-- SQLite can't add a NOT NULL column without a default; the app always sets team_id, and the
-- default is never left on a row.
ALTER TABLE tree_sets ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
UPDATE tree_sets SET team_id = 'frc1648' WHERE team_id = '';
CREATE UNIQUE INDEX tree_sets_team ON tree_sets (team_id);

-- Mentors now come from the team's member list, which carries roles (@g3/platform teamMembers),
-- instead of what sign-ins told Skill Tree.
DROP TABLE mentors;
