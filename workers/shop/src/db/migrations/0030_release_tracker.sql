-- The release tracker (lib/release-tracker.ts): Shop keeps a separate Onshape document (the
-- tracking document) with a copy of every part studio in the team's Onshape document, each part
-- derived from the version it was last released in and colored by how far along it is in the shop.

-- A team's tracker: the tracking document an admin linked, and its sync window. Every change
-- that could change a color opens a 20-minute window (sync_due_at); one sync runs when it closes.
CREATE TABLE release_trackers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  -- The team's Onshape document when the tracker was set up; it stops if Shop follows another.
  source_document_id TEXT NOT NULL,
  -- The tracking document and its workspace.
  document_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- Unix ms when the open window's sync runs; null when no window is open.
  sync_due_at INTEGER,
  -- 1 when the next sync must read Onshape again (a release, a new version, set up, Sync now);
  -- 0 when only statuses in Shop changed, which needs no reads.
  refresh INTEGER NOT NULL DEFAULT 1,
  -- Unix ms a sync started; null when none is running. Keeps two from running at once.
  sync_started_at INTEGER,
  -- Unix ms the last sync finished, the source version it read, and what went wrong, if anything.
  synced_at INTEGER,
  source_version_id TEXT,
  error TEXT,
  UNIQUE (team_id)
);

-- Each part studio in the team's document at the version last read, and its copy in the tracking
-- document (element_id: null until it's made).
CREATE TABLE release_tracker_studios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  source_element_id TEXT NOT NULL,
  name TEXT NOT NULL,
  element_id TEXT,
  -- The name the copy was given, so a renamed part studio is renamed in the copy too.
  copy_name TEXT,
  -- 1 once the part studio is gone from the team's document: its copy is deleted next sync.
  removed INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER,
  error TEXT,
  UNIQUE (team_id, source_element_id)
);

-- Each part in those part studios at the version last read, and where its copy comes from: the
-- version it was last released in (with its part number, revision and release), or the newest
-- version when it was never released (part_number and revision null).
CREATE TABLE release_tracker_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  source_element_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  name TEXT,
  part_number TEXT,
  revision TEXT,
  release_name TEXT,
  version_id TEXT NOT NULL,
  -- The part studio and part id at that version (a part can move between versions).
  from_element_id TEXT NOT NULL,
  from_part_id TEXT NOT NULL,
  UNIQUE (team_id, source_element_id, part_id)
);
CREATE INDEX release_tracker_parts_team_idx ON release_tracker_parts (team_id, part_number);

-- The features Shop put in each copy: one per release version and status. `signature` is what
-- was written, so a sync only sends the ones that changed.
CREATE TABLE release_tracker_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  source_element_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  UNIQUE (team_id, source_element_id, group_key)
);

-- A part studio's microversion at a version of the team's document, which a copied part's
-- reference needs. A version never changes, so each is read from Onshape once.
CREATE TABLE release_tracker_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  element_id TEXT NOT NULL,
  microversion_id TEXT NOT NULL,
  UNIQUE (team_id, version_id, element_id)
);
