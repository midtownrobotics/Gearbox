-- Skill Tree's data as rows, like the other apps keep theirs, and a fresh start.
--
--   * The trees are a team's own content, not part of the app: a "tree set" that is loaded from a
--     file (content/default-trees.json is the one a team starts with) and edited in the app. This
--     migration holds no trees.
--   * Progress is one row per person per skill, with who signed it off.
--   * The old tables go, and with them EVERYONE'S SAVED PROGRESS and the app's own mentor lists.
--     Students are now G3ID's accounts that aren't mentors; mentors are G3ID's mentors and admins.
--
-- All of this is one team's data, and everything hangs off the team's tree set: keys are unique
-- inside a set, a tree or a category, never across the whole table, so a team column on tree_sets
-- is all that a second team needs here (roadmap Phase 3).

DROP TABLE skill_progress;
DROP TABLE skill_mentors;
DROP TABLE skill_site_mentors;

-- The trees a team uses, as one set that can be saved to a file and loaded from one. A single row
-- until tables carry a team; then one per team.
CREATE TABLE tree_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  -- Who last loaded the set from a file. Null when the app loaded the default set itself.
  loaded_by_name TEXT,
  loaded_at INTEGER NOT NULL
);

-- `key` on trees, categories and skills is the name a file knows them by. Loading a file again
-- matches rows by key, so a skill that's still in the file keeps everyone's progress on it.

CREATE TABLE trees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tree_set_id INTEGER NOT NULL REFERENCES tree_sets(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  -- An emoji shown beside the name.
  icon TEXT NOT NULL DEFAULT '',
  -- The tree a student must finish before this one opens (Safety, in the default set).
  requires_tree_id INTEGER REFERENCES trees(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX trees_key_idx ON trees(tree_set_id, key);

-- A tree's groups of skills ("Shop Safety"). A category opens when the ones it requires are done.
CREATE TABLE tree_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tree_id INTEGER NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX tree_categories_key_idx ON tree_categories(tree_id, key);

CREATE TABLE category_prereqs (
  category_id INTEGER NOT NULL REFERENCES tree_categories(id) ON DELETE CASCADE,
  requires_category_id INTEGER NOT NULL REFERENCES tree_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, requires_category_id)
);

CREATE TABLE skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The category's tree's set, repeated here so a skill's key can be unique in the whole set: a
  -- skill moved to another category in a file is still the same skill.
  tree_set_id INTEGER NOT NULL REFERENCES tree_sets(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES tree_categories(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  -- A few words under the name on the skill's box.
  summary TEXT NOT NULL DEFAULT '',
  -- What a student must show to have the skill signed off.
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX skills_key_idx ON skills(tree_set_id, key);
CREATE INDEX skills_category_idx ON skills(category_id);

-- Skills in the same category that must be complete first.
CREATE TABLE skill_prereqs (
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  requires_skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (skill_id, requires_skill_id)
);

-- A student's progress on a skill, by G3ID user id. No row means not started.
CREATE TABLE skill_progress (
  user_id TEXT NOT NULL,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('in-progress', 'complete')),
  -- The mentor who set it.
  updated_by_id TEXT NOT NULL,
  updated_by_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skill_id)
);
CREATE INDEX skill_progress_skill_idx ON skill_progress(skill_id);

-- G3ID accounts known to be mentors, which are left out of the list of students. G3ID's list of
-- accounts doesn't say who is a mentor, so this is what Skill Tree has learned from sign-ins
-- (src/lib/roster.ts).
CREATE TABLE mentors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL
);
CREATE UNIQUE INDEX mentors_user_idx ON mentors(user_id);
