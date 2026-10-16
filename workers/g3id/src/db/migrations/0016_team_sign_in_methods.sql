-- Which sign-in methods a team's members may use, chosen by its admins on the Sign-in page of the
-- team's admin pages. A team without a row allows them all. Slack has no column: members join
-- through it, so it's always on.
CREATE TABLE team_sign_in_methods (
  team_id TEXT PRIMARY KEY NOT NULL,
  google INTEGER NOT NULL DEFAULT 1,
  github INTEGER NOT NULL DEFAULT 1,
  steam INTEGER NOT NULL DEFAULT 1,
  kiosk_pin INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES core_users(id) ON DELETE SET NULL
);
