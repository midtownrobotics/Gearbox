-- Existing rows use a reserved migration owner, adopted by the configured site team
-- in db/bootstrap.ts. New writes always supply authenticated team ownership.
PRAGMA defer_foreign_keys = true;
DROP TRIGGER IF EXISTS game_bets_require_funds;
DROP TRIGGER IF EXISTS game_parlays_require_funds;
DROP TRIGGER IF EXISTS scouting_submission_one_per_match;
CREATE TABLE auto_routines_legacy AS SELECT * FROM auto_routines;
CREATE TABLE boylebucks_accounts_legacy AS SELECT * FROM boylebucks_accounts;
CREATE TABLE boylebucks_ledger_legacy AS SELECT * FROM boylebucks_ledger;
CREATE TABLE field_map_publishers_legacy AS SELECT * FROM field_map_publishers;
CREATE TABLE field_maps_legacy AS SELECT * FROM field_maps;
CREATE TABLE game_bets_legacy AS SELECT * FROM game_bets;
CREATE TABLE game_parlay_legs_legacy AS SELECT * FROM game_parlay_legs;
CREATE TABLE game_parlays_legacy AS SELECT * FROM game_parlays;
CREATE TABLE manual_events_legacy AS SELECT * FROM manual_events;
CREATE TABLE manual_matches_legacy AS SELECT * FROM manual_matches;
CREATE TABLE manual_scan_cache_legacy AS SELECT * FROM manual_scan_cache;
CREATE TABLE manual_scan_usage_legacy AS SELECT * FROM manual_scan_usage;
CREATE TABLE manual_teams_legacy AS SELECT * FROM manual_teams;
CREATE TABLE robot_images_legacy AS SELECT * FROM robot_images;
CREATE TABLE robot_teams_legacy AS SELECT * FROM robot_teams;
CREATE TABLE scouting_engagement_settings_legacy AS SELECT * FROM scouting_engagement_settings;
CREATE TABLE scouting_form_submissions_legacy AS SELECT * FROM scouting_form_submissions;
CREATE TABLE scouting_forms_legacy AS SELECT * FROM scouting_forms;
CREATE TABLE scouting_match_assignments_legacy AS SELECT * FROM scouting_match_assignments;
CREATE TABLE service_helpers_legacy AS SELECT * FROM service_helpers;
CREATE TABLE service_tickets_legacy AS SELECT * FROM service_tickets;
CREATE TABLE strategy_admins_legacy AS SELECT * FROM strategy_admins;
CREATE TABLE strategy_announcements_legacy AS SELECT * FROM strategy_announcements;
CREATE TABLE strategy_event_config_legacy AS SELECT * FROM strategy_event_config;
CREATE TABLE strategy_presence_legacy AS SELECT * FROM strategy_presence;
CREATE TABLE team_comments_legacy AS SELECT * FROM team_comments;
CREATE TABLE tier_lists_legacy AS SELECT * FROM tier_lists;
DROP TABLE tier_lists;
DROP TABLE team_comments;
DROP TABLE strategy_presence;
DROP TABLE strategy_event_config;
DROP TABLE strategy_announcements;
DROP TABLE strategy_admins;
DROP TABLE service_tickets;
DROP TABLE service_helpers;
DROP TABLE scouting_match_assignments;
DROP TABLE scouting_forms;
DROP TABLE scouting_form_submissions;
DROP TABLE scouting_engagement_settings;
DROP TABLE robot_teams;
DROP TABLE robot_images;
DROP TABLE manual_teams;
DROP TABLE manual_scan_usage;
DROP TABLE manual_scan_cache;
DROP TABLE manual_matches;
DROP TABLE manual_events;
DROP TABLE game_parlays;
DROP TABLE game_parlay_legs;
DROP TABLE game_bets;
DROP TABLE field_maps;
DROP TABLE field_map_publishers;
DROP TABLE boylebucks_ledger;
DROP TABLE boylebucks_accounts;
DROP TABLE auto_routines;
CREATE TABLE auto_routines (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  robot_name TEXT NOT NULL DEFAULT '',
  start_position TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  steps_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, image_r2_key TEXT, image_content_type TEXT,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE boylebucks_accounts (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  earned INTEGER NOT NULL DEFAULT 0 CHECK (earned >= 0),
  wagered INTEGER NOT NULL DEFAULT 0 CHECK (wagered >= 0),
  updated_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE boylebucks_ledger (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id TEXT NOT NULL ,
  created_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id, id),
  UNIQUE (team_id, reference_id)
);
CREATE TABLE field_map_publishers (
  team_id TEXT NOT NULL,
  email TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id, email)
);
CREATE TABLE field_maps (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  event_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE game_bets (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  event_key TEXT NOT NULL,
  match_key TEXT NOT NULL,
  match_label TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('spread', 'total', 'moneyline')),
  selection TEXT NOT NULL,
  line REAL NOT NULL,
  odds INTEGER NOT NULL,
  stake INTEGER NOT NULL CHECK (stake > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'push')),
  payout INTEGER NOT NULL DEFAULT 0,
  placed_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE (team_id, user_id, match_key, market)
,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE game_parlay_legs (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  parlay_id TEXT NOT NULL,
  match_key TEXT NOT NULL,
  match_label TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('spread', 'total', 'moneyline')),
  selection TEXT NOT NULL,
  line REAL NOT NULL,
  odds INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'push')),
  FOREIGN KEY (team_id, parlay_id) REFERENCES game_parlays(team_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE (team_id, parlay_id, match_key)
,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE game_parlays (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  event_key TEXT NOT NULL,
  odds INTEGER NOT NULL,
  stake INTEGER NOT NULL CHECK (stake > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'push')),
  payout INTEGER NOT NULL DEFAULT 0,
  placed_at INTEGER NOT NULL,
  settled_at INTEGER
,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE manual_events (
  team_id TEXT NOT NULL,
  event_key TEXT NOT NULL ,
  event_name TEXT NOT NULL,
  ends_at INTEGER NOT NULL,
  delete_after INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id, event_key)
);
CREATE TABLE manual_matches (
  team_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  match_key TEXT NOT NULL,
  comp_level TEXT NOT NULL DEFAULT 'qm',
  set_number INTEGER NOT NULL DEFAULT 1,
  match_number INTEGER NOT NULL,
  scheduled_at INTEGER,
  red_1 TEXT NOT NULL,
  red_2 TEXT NOT NULL,
  red_3 TEXT NOT NULL,
  blue_1 TEXT NOT NULL,
  blue_2 TEXT NOT NULL,
  blue_3 TEXT NOT NULL,

  FOREIGN KEY (team_id, event_key) REFERENCES manual_events(team_id, event_key) ON DELETE CASCADE ON UPDATE CASCADE
,
  PRIMARY KEY (team_id, event_key, match_key)
);
CREATE TABLE manual_scan_cache (
  team_id TEXT NOT NULL,
  content_hash TEXT NOT NULL ,
  result_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id, content_hash)
);
CREATE TABLE manual_scan_usage (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, user_id, window_started_at)
);
CREATE TABLE manual_teams (
  team_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  team_number TEXT NOT NULL,
  team_name TEXT NOT NULL DEFAULT '',

  FOREIGN KEY (team_id, event_key) REFERENCES manual_events(team_id, event_key) ON DELETE CASCADE ON UPDATE CASCADE
,
  PRIMARY KEY (team_id, event_key, team_number)
);
CREATE TABLE robot_images (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  robot_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (team_id, robot_id) REFERENCES robot_teams(team_id, id) ON DELETE CASCADE ON UPDATE CASCADE
,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE robot_teams (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE scouting_engagement_settings (
  team_id TEXT ,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  predictions_enabled INTEGER NOT NULL DEFAULT 1 CHECK (predictions_enabled IN (0, 1)),
  combinations_enabled INTEGER NOT NULL DEFAULT 0 CHECK (combinations_enabled IN (0, 1)),
  leaderboard_enabled INTEGER NOT NULL DEFAULT 0 CHECK (leaderboard_enabled IN (0, 1)),
  points_label TEXT NOT NULL DEFAULT 'Scout Points',
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id)
);
CREATE TABLE scouting_form_submissions (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  drawing_r2_key TEXT,
  drawing_content_type TEXT,
  submitted_by TEXT NOT NULL,
  submitted_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL, team_name TEXT NOT NULL DEFAULT '', drawing_fields_json TEXT NOT NULL DEFAULT '{}', event_key TEXT, match_key TEXT, match_number INTEGER, starred_fields_json TEXT NOT NULL DEFAULT '[]', archived_at INTEGER, archived_by TEXT, archive_reason TEXT, fields_json TEXT,
  FOREIGN KEY (team_id, form_id) REFERENCES scouting_forms(team_id, id) ON DELETE CASCADE ON UPDATE CASCADE
,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE scouting_forms (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, form_kind TEXT NOT NULL DEFAULT 'scouting',
  PRIMARY KEY (team_id, id)
);
CREATE TABLE scouting_match_assignments (
  team_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  match_number INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  team_number TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, event_key, match_number, user_id)
);
CREATE TABLE service_helpers (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  slack_user_id TEXT,
  skills_json TEXT NOT NULL DEFAULT '[]',
  approved_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE service_tickets (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  issue_type TEXT NOT NULL CHECK (issue_type IN ('mechanical', 'electrical', 'programming', 'other')),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'closed')),
  claimed_by TEXT,
  claimed_by_name TEXT,
  resolution TEXT,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, event_key TEXT, match_key TEXT, match_number INTEGER,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE strategy_admins (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE strategy_announcements (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE strategy_event_config (
  team_id TEXT NOT NULL,
  id INTEGER NOT NULL  ,
  event_key TEXT NOT NULL DEFAULT '',
  current_match_number INTEGER,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
, tba_auth_key TEXT, nexus_event_key TEXT, nexus_api_key TEXT, schedule_mode TEXT NOT NULL DEFAULT 'tba',
  PRIMARY KEY (team_id, id)
);
CREATE TABLE strategy_presence (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL ,
  display_name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL
, current_page TEXT,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE team_comments (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  comment TEXT NOT NULL,
  event_key TEXT,
  source_ticket_id TEXT,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE tier_lists (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tiers_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
,
  PRIMARY KEY (team_id, id)
);
INSERT INTO scouting_forms (team_id, id, name, description, fields_json, is_active, created_by, created_at, updated_at, form_kind) SELECT '__legacy_scouting__', id, name, description, fields_json, is_active, created_by, created_at, updated_at, form_kind FROM scouting_forms_legacy;
INSERT INTO robot_teams (team_id, id, team_name, summary, created_by, created_at, updated_at) SELECT '__legacy_scouting__', id, team_name, summary, created_by, created_at, updated_at FROM robot_teams_legacy;
INSERT INTO manual_events (team_id, event_key, event_name, ends_at, delete_after, created_by, updated_at) SELECT '__legacy_scouting__', event_key, event_name, ends_at, delete_after, created_by, updated_at FROM manual_events_legacy;
INSERT INTO game_parlays (team_id, id, user_id, user_name, event_key, odds, stake, status, payout, placed_at, settled_at) SELECT '__legacy_scouting__', id, user_id, user_name, event_key, odds, stake, status, payout, placed_at, settled_at FROM game_parlays_legacy;
INSERT INTO auto_routines (team_id, id, name, robot_name, start_position, summary, steps_json, tags_json, created_by, created_at, updated_at, image_r2_key, image_content_type) SELECT '__legacy_scouting__', id, name, robot_name, start_position, summary, steps_json, tags_json, created_by, created_at, updated_at, image_r2_key, image_content_type FROM auto_routines_legacy;
INSERT INTO boylebucks_accounts (team_id, user_id, display_name, balance, earned, wagered, updated_at) SELECT '__legacy_scouting__', user_id, display_name, balance, earned, wagered, updated_at FROM boylebucks_accounts_legacy;
INSERT INTO boylebucks_ledger (team_id, id, user_id, amount, reason, reference_id, created_at) SELECT '__legacy_scouting__', id, user_id, amount, reason, reference_id, created_at FROM boylebucks_ledger_legacy;
INSERT INTO field_map_publishers (team_id, email, granted_by, created_at) SELECT '__legacy_scouting__', email, granted_by, created_at FROM field_map_publishers_legacy;
INSERT INTO field_maps (team_id, id, name, event_name, notes, r2_key, content_type, created_by, created_at, updated_at) SELECT '__legacy_scouting__', id, name, event_name, notes, r2_key, content_type, created_by, created_at, updated_at FROM field_maps_legacy;
INSERT INTO game_bets (team_id, id, user_id, user_name, event_key, match_key, match_label, market, selection, line, odds, stake, status, payout, placed_at, settled_at) SELECT '__legacy_scouting__', id, user_id, user_name, event_key, match_key, match_label, market, selection, line, odds, stake, status, payout, placed_at, settled_at FROM game_bets_legacy;
INSERT INTO game_parlay_legs (team_id, id, parlay_id, match_key, match_label, market, selection, line, odds, status) SELECT '__legacy_scouting__', id, parlay_id, match_key, match_label, market, selection, line, odds, status FROM game_parlay_legs_legacy;
INSERT INTO manual_matches (team_id, event_key, match_key, comp_level, set_number, match_number, scheduled_at, red_1, red_2, red_3, blue_1, blue_2, blue_3) SELECT '__legacy_scouting__', event_key, match_key, comp_level, set_number, match_number, scheduled_at, red_1, red_2, red_3, blue_1, blue_2, blue_3 FROM manual_matches_legacy;
INSERT INTO manual_scan_cache (team_id, content_hash, result_json, expires_at) SELECT '__legacy_scouting__', content_hash, result_json, expires_at FROM manual_scan_cache_legacy;
INSERT INTO manual_scan_usage (team_id, user_id, window_started_at, page_count) SELECT '__legacy_scouting__', user_id, window_started_at, page_count FROM manual_scan_usage_legacy;
INSERT INTO manual_teams (team_id, event_key, team_number, team_name) SELECT '__legacy_scouting__', event_key, team_number, team_name FROM manual_teams_legacy;
INSERT INTO robot_images (team_id, id, robot_id, r2_key, content_type, created_by, created_at) SELECT '__legacy_scouting__', id, team_id, r2_key, content_type, created_by, created_at FROM robot_images_legacy;
INSERT INTO scouting_engagement_settings (team_id, enabled, predictions_enabled, combinations_enabled, leaderboard_enabled, points_label, updated_by, updated_at) SELECT team_key, enabled, predictions_enabled, combinations_enabled, leaderboard_enabled, points_label, updated_by, updated_at FROM scouting_engagement_settings_legacy;
INSERT INTO scouting_form_submissions (team_id, id, form_id, answers_json, drawing_r2_key, drawing_content_type, submitted_by, submitted_by_name, created_at, team_name, drawing_fields_json, event_key, match_key, match_number, starred_fields_json, archived_at, archived_by, archive_reason, fields_json) SELECT '__legacy_scouting__', id, form_id, answers_json, drawing_r2_key, drawing_content_type, submitted_by, submitted_by_name, created_at, team_name, drawing_fields_json, event_key, match_key, match_number, starred_fields_json, archived_at, archived_by, archive_reason, fields_json FROM scouting_form_submissions_legacy;
INSERT INTO scouting_match_assignments (team_id, event_key, match_number, user_id, team_number, assigned_at) SELECT '__legacy_scouting__', event_key, match_number, user_id, team_number, assigned_at FROM scouting_match_assignments_legacy;
INSERT INTO service_helpers (team_id, user_id, display_name, email, slack_user_id, skills_json, approved_by, created_at) SELECT '__legacy_scouting__', user_id, display_name, email, slack_user_id, skills_json, approved_by, created_at FROM service_helpers_legacy;
INSERT INTO service_tickets (team_id, id, team_name, issue_type, description, status, claimed_by, claimed_by_name, resolution, created_by, created_by_name, created_at, updated_at, event_key, match_key, match_number) SELECT '__legacy_scouting__', id, team_name, issue_type, description, status, claimed_by, claimed_by_name, resolution, created_by, created_by_name, created_at, updated_at, event_key, match_key, match_number FROM service_tickets_legacy;
INSERT INTO strategy_admins (team_id, user_id, email, display_name, granted_by, created_at) SELECT '__legacy_scouting__', user_id, email, display_name, granted_by, created_at FROM strategy_admins_legacy;
INSERT INTO strategy_announcements (team_id, id, message, created_by, created_by_name, created_at, expires_at) SELECT '__legacy_scouting__', id, message, created_by, created_by_name, created_at, expires_at FROM strategy_announcements_legacy;
INSERT INTO strategy_event_config (team_id, id, event_key, current_match_number, updated_by, updated_at, tba_auth_key, nexus_event_key, nexus_api_key, schedule_mode) SELECT '__legacy_scouting__', id, event_key, current_match_number, updated_by, updated_at, tba_auth_key, nexus_event_key, nexus_api_key, schedule_mode FROM strategy_event_config_legacy;
INSERT INTO strategy_presence (team_id, user_id, display_name, is_admin, last_seen_at, current_page) SELECT '__legacy_scouting__', user_id, display_name, is_admin, last_seen_at, current_page FROM strategy_presence_legacy;
INSERT INTO team_comments (team_id, id, team_name, comment, event_key, source_ticket_id, created_by, created_by_name, created_at) SELECT '__legacy_scouting__', id, team_name, comment, event_key, source_ticket_id, created_by, created_by_name, created_at FROM team_comments_legacy;
INSERT INTO tier_lists (team_id, id, name, description, tiers_json, created_by, created_at, updated_at) SELECT '__legacy_scouting__', id, name, description, tiers_json, created_by, created_at, updated_at FROM tier_lists_legacy;
DROP TABLE auto_routines_legacy;
DROP TABLE boylebucks_accounts_legacy;
DROP TABLE boylebucks_ledger_legacy;
DROP TABLE field_map_publishers_legacy;
DROP TABLE field_maps_legacy;
DROP TABLE game_bets_legacy;
DROP TABLE game_parlay_legs_legacy;
DROP TABLE game_parlays_legacy;
DROP TABLE manual_events_legacy;
DROP TABLE manual_matches_legacy;
DROP TABLE manual_scan_cache_legacy;
DROP TABLE manual_scan_usage_legacy;
DROP TABLE manual_teams_legacy;
DROP TABLE robot_images_legacy;
DROP TABLE robot_teams_legacy;
DROP TABLE scouting_engagement_settings_legacy;
DROP TABLE scouting_form_submissions_legacy;
DROP TABLE scouting_forms_legacy;
DROP TABLE scouting_match_assignments_legacy;
DROP TABLE service_helpers_legacy;
DROP TABLE service_tickets_legacy;
DROP TABLE strategy_admins_legacy;
DROP TABLE strategy_announcements_legacy;
DROP TABLE strategy_event_config_legacy;
DROP TABLE strategy_presence_legacy;
DROP TABLE team_comments_legacy;
DROP TABLE tier_lists_legacy;
CREATE INDEX tier_lists_updated_idx ON tier_lists(team_id, updated_at DESC);
CREATE INDEX field_maps_updated_idx ON field_maps(team_id, updated_at DESC);
CREATE INDEX auto_routines_updated_idx ON auto_routines(team_id, updated_at DESC);
CREATE INDEX robot_teams_updated_idx ON robot_teams(team_id, updated_at DESC);
CREATE INDEX robot_images_team_idx ON robot_images(team_id, robot_id, created_at DESC);
CREATE INDEX scouting_forms_updated_idx ON scouting_forms(team_id, updated_at DESC);
CREATE INDEX scouting_form_submissions_form_idx ON scouting_form_submissions(team_id, form_id, created_at DESC);
CREATE INDEX strategy_admins_email_idx ON strategy_admins(team_id, email);
CREATE INDEX scouting_form_submissions_team_idx ON scouting_form_submissions(team_id, team_name, created_at DESC);
CREATE INDEX service_tickets_status_idx ON service_tickets(team_id, status, created_at DESC);
CREATE INDEX scouting_submissions_team_lower_idx
  ON scouting_form_submissions(team_id, LOWER(team_name), created_at DESC);
CREATE INDEX service_tickets_priority_idx
  ON service_tickets(team_id, status, created_at DESC);
CREATE INDEX strategy_presence_online_idx
  ON strategy_presence(team_id, is_admin, last_seen_at DESC);
CREATE INDEX service_tickets_status_updated_idx
  ON service_tickets(team_id, status, updated_at DESC);
CREATE INDEX scouting_submissions_event_match_idx
  ON scouting_form_submissions(team_id, event_key, match_key, team_name, created_at DESC);
CREATE INDEX service_tickets_event_team_idx
  ON service_tickets(team_id, event_key, team_name, updated_at DESC);
CREATE INDEX scouting_submissions_team_event_starred_idx
  ON scouting_form_submissions(team_id, team_name, event_key, starred_fields_json, created_at DESC);
CREATE INDEX scouting_submissions_archive_idx
  ON scouting_form_submissions(team_id, archived_at, team_name, event_key, created_at DESC);
CREATE INDEX team_comments_team_event_idx
  ON team_comments(team_id, team_name, event_key, created_at DESC);
CREATE INDEX scouting_submissions_event_created_idx
  ON scouting_form_submissions(team_id, event_key, created_at DESC);
CREATE INDEX scouting_submissions_form_created_idx
  ON scouting_form_submissions(team_id, form_id, created_at DESC);
CREATE INDEX service_tickets_team_event_updated_idx
  ON service_tickets(team_id, team_name, event_key, updated_at DESC);
CREATE INDEX team_comments_event_created_idx
  ON team_comments(team_id, event_key, created_at DESC);
CREATE INDEX strategy_announcements_active_idx
  ON strategy_announcements(team_id, expires_at DESC, created_at DESC);
CREATE INDEX manual_events_cleanup_idx ON manual_events(team_id, delete_after);
CREATE INDEX manual_matches_order_idx ON manual_matches(team_id, event_key, comp_level, match_number);
CREATE INDEX manual_scan_cache_expiry_idx ON manual_scan_cache(team_id, expires_at);
CREATE INDEX scouting_match_assignments_match_idx
  ON scouting_match_assignments(team_id, event_key, match_number);
CREATE INDEX boylebucks_accounts_rank_idx
  ON boylebucks_accounts(team_id, balance DESC, earned DESC, display_name);
CREATE INDEX boylebucks_ledger_user_idx
  ON boylebucks_ledger(team_id, user_id, created_at DESC);
CREATE INDEX game_bets_user_idx
  ON game_bets(team_id, user_id, placed_at DESC);
CREATE INDEX game_bets_open_idx
  ON game_bets(team_id, event_key, status, match_key);
CREATE INDEX game_parlays_user_idx ON game_parlays(team_id, user_id, placed_at DESC);
CREATE INDEX game_parlays_open_idx ON game_parlays(team_id, event_key, status);
CREATE INDEX game_parlay_legs_parlay_idx ON game_parlay_legs(team_id, parlay_id);
CREATE TRIGGER game_bets_require_funds
BEFORE INSERT ON game_bets
BEGIN
  SELECT RAISE(ABORT, 'insufficient BoyleBucks')
  WHERE COALESCE(
    (SELECT balance FROM boylebucks_accounts WHERE team_id = NEW.team_id AND user_id = NEW.user_id),
    -1
  ) < NEW.stake;
END;
CREATE TRIGGER game_parlays_require_funds
BEFORE INSERT ON game_parlays
BEGIN
  SELECT RAISE(ABORT, 'insufficient BoyleBucks')
  WHERE COALESCE(
    (SELECT balance FROM boylebucks_accounts WHERE team_id = NEW.team_id AND user_id = NEW.user_id),
    -1
  ) < NEW.stake;
END;
CREATE TRIGGER scouting_submission_one_per_match
BEFORE INSERT ON scouting_form_submissions
WHEN (SELECT form_kind FROM scouting_forms WHERE team_id = NEW.team_id AND id = NEW.form_id) = 'scouting'
  AND EXISTS (
    SELECT 1
      FROM scouting_form_submissions existing
      JOIN scouting_forms existing_form ON existing_form.id = existing.form_id
     WHERE existing.team_id = NEW.team_id AND existing_form.team_id = NEW.team_id AND existing_form.form_kind = 'scouting'
       AND existing.submitted_by = NEW.submitted_by
       AND existing.event_key = NEW.event_key
       AND existing.match_number = NEW.match_number
  )
BEGIN
  SELECT RAISE(ABORT, 'one scouting submission per match');
END;
