import {
  foreignKey,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

export const autoRoutines = sqliteTable(
  "auto_routines",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    robot_name: text("robot_name").notNull().default(""),
    start_position: text("start_position").notNull().default(""),
    summary: text("summary").notNull().default(""),
    steps_json: text("steps_json").notNull(),
    tags_json: text("tags_json").notNull(),
    created_by: text("created_by").notNull(),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
    image_r2_key: text("image_r2_key"),
    image_content_type: text("image_content_type"),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.id] })],
);

export const boylebucksAccounts = sqliteTable(
  "boylebucks_accounts",
  {
    teamId: text("team_id").notNull(),
    user_id: text("user_id").notNull(),
    display_name: text("display_name").notNull(),
    balance: integer("balance").notNull().default(0),
    earned: integer("earned").notNull().default(0),
    wagered: integer("wagered").notNull().default(0),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.user_id] })],
);

export const boylebucksLedger = sqliteTable(
  "boylebucks_ledger",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    user_id: text("user_id").notNull(),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    reference_id: text("reference_id").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.id] }), unique().on(t.teamId, t.reference_id)],
);

export const fieldMapPublishers = sqliteTable(
  "field_map_publishers",
  {
    teamId: text("team_id").notNull(),
    email: text("email").notNull(),
    granted_by: text("granted_by").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.email] })],
);

export const fieldMaps = sqliteTable(
  "field_maps",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    event_name: text("event_name").notNull().default(""),
    notes: text("notes").notNull().default(""),
    r2_key: text("r2_key").notNull(),
    content_type: text("content_type").notNull(),
    created_by: text("created_by").notNull(),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.id] })],
);

export const gameBets = sqliteTable(
  "game_bets",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    user_id: text("user_id").notNull(),
    user_name: text("user_name").notNull(),
    event_key: text("event_key").notNull(),
    match_key: text("match_key").notNull(),
    match_label: text("match_label").notNull(),
    market: text("market").notNull(),
    selection: text("selection").notNull(),
    line: real("line").notNull(),
    odds: integer("odds").notNull(),
    stake: integer("stake").notNull(),
    status: text("status").notNull().default("open"),
    payout: integer("payout").notNull().default(0),
    placed_at: integer("placed_at").notNull(),
    settled_at: integer("settled_at"),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.id] }),
    unique().on(t.teamId, t.user_id, t.match_key, t.market),
  ],
);

export const gameParlayLegs = sqliteTable(
  "game_parlay_legs",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    parlay_id: text("parlay_id").notNull(),
    match_key: text("match_key").notNull(),
    match_label: text("match_label").notNull(),
    market: text("market").notNull(),
    selection: text("selection").notNull(),
    line: real("line").notNull(),
    odds: integer("odds").notNull(),
    status: text("status").notNull().default("open"),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.id] }),
    unique().on(t.teamId, t.parlay_id, t.match_key),
    foreignKey({
      columns: [t.teamId, t.parlay_id],
      foreignColumns: [gameParlays.teamId, gameParlays.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const gameParlays = sqliteTable(
  "game_parlays",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    user_id: text("user_id").notNull(),
    user_name: text("user_name").notNull(),
    event_key: text("event_key").notNull(),
    odds: integer("odds").notNull(),
    stake: integer("stake").notNull(),
    status: text("status").notNull().default("open"),
    payout: integer("payout").notNull().default(0),
    placed_at: integer("placed_at").notNull(),
    settled_at: integer("settled_at"),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.id] })],
);

export const manualEvents = sqliteTable(
  "manual_events",
  {
    teamId: text("team_id").notNull(),
    event_key: text("event_key").notNull(),
    event_name: text("event_name").notNull(),
    ends_at: integer("ends_at").notNull(),
    delete_after: integer("delete_after").notNull(),
    created_by: text("created_by").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.event_key] })],
);

export const manualMatches = sqliteTable(
  "manual_matches",
  {
    teamId: text("team_id").notNull(),
    event_key: text("event_key").notNull(),
    match_key: text("match_key").notNull(),
    comp_level: text("comp_level").notNull().default("qm"),
    set_number: integer("set_number").notNull().default(1),
    match_number: integer("match_number").notNull(),
    scheduled_at: integer("scheduled_at"),
    red_1: text("red_1").notNull(),
    red_2: text("red_2").notNull(),
    red_3: text("red_3").notNull(),
    blue_1: text("blue_1").notNull(),
    blue_2: text("blue_2").notNull(),
    blue_3: text("blue_3").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.event_key, t.match_key] }),
    foreignKey({
      columns: [t.teamId, t.event_key],
      foreignColumns: [manualEvents.teamId, manualEvents.event_key],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const manualScanCache = sqliteTable(
  "manual_scan_cache",
  {
    teamId: text("team_id").notNull(),
    content_hash: text("content_hash").notNull(),
    result_json: text("result_json").notNull(),
    expires_at: integer("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.content_hash] })],
);

export const manualScanUsage = sqliteTable(
  "manual_scan_usage",
  {
    teamId: text("team_id").notNull(),
    user_id: text("user_id").notNull(),
    window_started_at: integer("window_started_at").notNull(),
    page_count: integer("page_count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.user_id, t.window_started_at] })],
);

export const manualTeams = sqliteTable(
  "manual_teams",
  {
    teamId: text("team_id").notNull(),
    event_key: text("event_key").notNull(),
    team_number: text("team_number").notNull(),
    team_name: text("team_name").notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.event_key, t.team_number] }),
    foreignKey({
      columns: [t.teamId, t.event_key],
      foreignColumns: [manualEvents.teamId, manualEvents.event_key],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const robotImages = sqliteTable(
  "robot_images",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    robot_id: text("robot_id").notNull(),
    r2_key: text("r2_key").notNull(),
    content_type: text("content_type").notNull(),
    created_by: text("created_by").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.id] }),
    foreignKey({
      columns: [t.teamId, t.robot_id],
      foreignColumns: [robotTeams.teamId, robotTeams.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const robotTeams = sqliteTable(
  "robot_teams",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    team_name: text("team_name").notNull(),
    summary: text("summary").notNull().default(""),
    created_by: text("created_by").notNull(),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.id] })],
);

export const scoutingEngagementSettings = sqliteTable(
  "scouting_engagement_settings",
  {
    teamId: text("team_id"),
    enabled: integer("enabled").notNull().default(0),
    predictions_enabled: integer("predictions_enabled").notNull().default(1),
    combinations_enabled: integer("combinations_enabled").notNull().default(0),
    leaderboard_enabled: integer("leaderboard_enabled").notNull().default(0),
    points_label: text("points_label").notNull().default("Scout Points"),
    updated_by: text("updated_by").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId] })],
);

export const scoutingFormSubmissions = sqliteTable(
  "scouting_form_submissions",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    form_id: text("form_id").notNull(),
    answers_json: text("answers_json").notNull(),
    drawing_r2_key: text("drawing_r2_key"),
    drawing_content_type: text("drawing_content_type"),
    submitted_by: text("submitted_by").notNull(),
    submitted_by_name: text("submitted_by_name").notNull(),
    created_at: integer("created_at").notNull(),
    team_name: text("team_name").notNull().default(""),
    drawing_fields_json: text("drawing_fields_json").notNull().default("{}"),
    event_key: text("event_key"),
    match_key: text("match_key"),
    match_number: integer("match_number"),
    starred_fields_json: text("starred_fields_json").notNull().default("[]"),
    archived_at: integer("archived_at"),
    archived_by: text("archived_by"),
    archive_reason: text("archive_reason"),
    fields_json: text("fields_json"),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.id] }),
    foreignKey({
      columns: [t.teamId, t.form_id],
      foreignColumns: [scoutingForms.teamId, scoutingForms.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const scoutingForms = sqliteTable(
  "scouting_forms",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    fields_json: text("fields_json").notNull(),
    is_active: integer("is_active").notNull().default(1),
    created_by: text("created_by").notNull(),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
    form_kind: text("form_kind").notNull().default("scouting"),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.id] })],
);

export const scoutingMatchAssignments = sqliteTable(
  "scouting_match_assignments",
  {
    teamId: text("team_id").notNull(),
    event_key: text("event_key").notNull(),
    match_number: integer("match_number").notNull(),
    user_id: text("user_id").notNull(),
    team_number: text("team_number").notNull(),
    assigned_at: integer("assigned_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.event_key, t.match_number, t.user_id] })],
);

export const serviceHelpers = sqliteTable(
  "service_helpers",
  {
    teamId: text("team_id").notNull(),
    user_id: text("user_id").notNull(),
    display_name: text("display_name").notNull(),
    email: text("email").notNull(),
    slack_user_id: text("slack_user_id"),
    skills_json: text("skills_json").notNull().default("[]"),
    approved_by: text("approved_by").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.user_id] })],
);

export const serviceTickets = sqliteTable(
  "service_tickets",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    team_name: text("team_name").notNull(),
    issue_type: text("issue_type").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("open"),
    claimed_by: text("claimed_by"),
    claimed_by_name: text("claimed_by_name"),
    resolution: text("resolution"),
    created_by: text("created_by").notNull(),
    created_by_name: text("created_by_name").notNull(),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
    event_key: text("event_key"),
    match_key: text("match_key"),
    match_number: integer("match_number"),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.id] })],
);

export const strategyAdmins = sqliteTable(
  "strategy_admins",
  {
    teamId: text("team_id").notNull(),
    user_id: text("user_id").notNull(),
    email: text("email").notNull(),
    display_name: text("display_name").notNull(),
    granted_by: text("granted_by").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.user_id] })],
);

export const strategyAnnouncements = sqliteTable(
  "strategy_announcements",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    message: text("message").notNull(),
    created_by: text("created_by").notNull(),
    created_by_name: text("created_by_name").notNull(),
    created_at: integer("created_at").notNull(),
    expires_at: integer("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.id] })],
);

export const strategyEventConfig = sqliteTable(
  "strategy_event_config",
  {
    teamId: text("team_id").notNull(),
    id: integer("id").notNull(),
    event_key: text("event_key").notNull().default(""),
    current_match_number: integer("current_match_number"),
    updated_by: text("updated_by").notNull(),
    updated_at: integer("updated_at").notNull(),
    tba_auth_key: text("tba_auth_key"),
    nexus_event_key: text("nexus_event_key"),
    nexus_api_key: text("nexus_api_key"),
    schedule_mode: text("schedule_mode").notNull().default("tba"),
    submission_window_seconds: integer("submission_window_seconds").notNull().default(120),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.id] })],
);

export const strategyPresence = sqliteTable(
  "strategy_presence",
  {
    teamId: text("team_id").notNull(),
    user_id: text("user_id").notNull(),
    display_name: text("display_name").notNull(),
    is_admin: integer("is_admin").notNull().default(0),
    last_seen_at: integer("last_seen_at").notNull(),
    current_page: text("current_page"),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.user_id] })],
);

export const tbaMatchCache = sqliteTable(
  "tba_match_cache",
  {
    event_key: text("event_key"),
    matches_json: text("matches_json").notNull(),
    expires_at: integer("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.event_key] })],
);

export const tbaTeamCache = sqliteTable(
  "tba_team_cache",
  {
    event_key: text("event_key").notNull(),
    teams_json: text("teams_json").notNull(),
    expires_at: integer("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.event_key] })],
);

export const teamComments = sqliteTable(
  "team_comments",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    team_name: text("team_name").notNull(),
    comment: text("comment").notNull(),
    event_key: text("event_key"),
    source_ticket_id: text("source_ticket_id"),
    created_by: text("created_by").notNull(),
    created_by_name: text("created_by_name").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.id] })],
);

export const tierLists = sqliteTable(
  "tier_lists",
  {
    teamId: text("team_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    tiers_json: text("tiers_json").notNull(),
    created_by: text("created_by").notNull(),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.id] })],
);
