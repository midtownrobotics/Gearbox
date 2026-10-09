import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

// Every table is one team's data (roadmap Phase 3, migration 0016): it has `team_id`, and every
// query on it goes through inTeam/withTeam from @g3/auth. Files in R2 are under teams/<team>/
// (lib/storage.ts).

/** The team a row belongs to ("frc<number>"). */
const teamId = () => text("team_id").notNull();

export const subsystems = sqliteTable("subsystems", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const partDefinitions = sqliteTable("part_definitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  onshapePartNumber: text("onshape_part_number").notNull(),
  revision: text("revision"),
  subsystemId: integer("subsystem_id")
    .notNull()
    .references(() => subsystems.id),
  creator: text("creator").notNull(),
  name: text("name"),
  notes: text("notes"),
  partDrawingUrl: text("part_drawing_url"),
  isObsolete: integer("is_obsolete").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  // Free text (e.g. "4140", "0.25\""); required when a process in the blueprint asks for it.
  material: text("material"),
  thickness: text("thickness"),
});

export const partInstances = sqliteTable(
  "part_instances",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: teamId(),
    partDefinitionId: integer("part_definition_id")
      .notNull()
      .references(() => partDefinitions.id),
    instanceNumber: integer("instance_number").notNull(),
    isPriority: integer("is_priority").notNull().default(0),
    isStale: integer("is_stale").notNull().default(0),
    // When it was made obsolete and who did it. Null when it isn't, or was before this was kept.
    obsoletedAt: integer("obsoleted_at"),
    obsoletedBy: text("obsoleted_by"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [unique().on(t.partDefinitionId, t.instanceNumber)],
);

export const PROCESS_TYPES = ["regular", "file_producer", "file_consumer"] as const;
export type ProcessType = (typeof PROCESS_TYPES)[number];

export const processes = sqliteTable("processes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  name: text("name").notNull(),
  type: text("type", { enum: PROCESS_TYPES }).notNull().default("regular"),
  // Parts using this process must record material + thickness at ingest.
  requiresPartInfo: integer("requires_part_info").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const partDefinitionProcessBlueprints = sqliteTable(
  "part_definition_process_blueprints",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: teamId(),
    partDefinitionId: integer("part_definition_id")
      .notNull()
      .references(() => partDefinitions.id),
    processId: integer("process_id")
      .notNull()
      .references(() => processes.id),
    index: integer("index").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [unique().on(t.partDefinitionId, t.index)],
);

export const partInstanceProcesses = sqliteTable(
  "part_instance_processes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: teamId(),
    partInstanceId: integer("part_instance_id")
      .notNull()
      .references(() => partInstances.id),
    processId: integer("process_id")
      .notNull()
      .references(() => processes.id),
    index: integer("index").notNull(),
    status: text("status", { enum: ["waiting", "todo", "doing", "done"] })
      .notNull()
      .default("waiting"),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    // Set while (and after) this step is produced as part of a File Producer staging batch.
    batchId: integer("batch_id").references(() => stagingBatches.id, { onDelete: "set null" }),
  },
  (t) => [unique().on(t.partInstanceId, t.index)],
);

/** Audit log of who moved which part instance through which process. */
export const actions = sqliteTable("actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  userId: text("user_id").notNull(),
  partInstanceId: integer("part_instance_id")
    .notNull()
    .references(() => partInstances.id),
  processId: integer("process_id")
    .notNull()
    .references(() => processes.id),
  action: text("action", { enum: ["started", "completed"] }).notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Who is currently logged in at each kiosk device (heartbeat-refreshed). */
export const kioskPresence = sqliteTable(
  "kiosk_presence",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: teamId(),
    kioskDeviceId: integer("kiosk_device_id").notNull(),
    deviceName: text("device_name").notNull(),
    userId: text("user_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [unique().on(t.teamId, t.kioskDeviceId)],
);

export const onshapeReleases = sqliteTable(
  "onshape_releases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: teamId(),
    releaseId: text("release_id").notNull(),
    timestamp: text("timestamp").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [unique().on(t.teamId, t.releaseId)],
);

export const onshapeParts = sqliteTable(
  "onshape_parts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: teamId(),
    entityId: text("entity_id"),
    partDrawingEntityId: text("part_drawing_entity_id"),
    onshapeReleaseId: text("onshape_release_id").notNull(),
    releaseId: integer("release_id").references(() => onshapeReleases.id),
    partNumber: text("part_number").notNull(),
    versionId: text("version_id"),
    quantity: integer("quantity"),
    revision: text("revision"),
    name: text("name"),
    description: text("description"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [unique().on(t.teamId, t.onshapeReleaseId, t.partNumber)],
);

export const drawings = sqliteTable("drawings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  partNumber: text("part_number").notNull(),
  filename: text("filename").notNull(),
  r2Key: text("r2_key").notNull(),
  fileSize: integer("file_size"),
  uploadedBy: text("uploaded_by"),
  createdAt: integer("created_at").notNull(),
});

export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  filename: text("filename").notNull(),
  r2Key: text("r2_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: integer("created_at").notNull(),
});

// One file per instance at most; a file can cover many instances across parts.
export const partInstanceFiles = sqliteTable("part_instance_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  fileId: integer("file_id")
    .notNull()
    .references(() => files.id, { onDelete: "cascade" }),
  partInstanceId: integer("part_instance_id")
    .notNull()
    .unique()
    .references(() => partInstances.id, { onDelete: "cascade" }),
  assignedBy: text("assigned_by").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const stagingBatches = sqliteTable("staging_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  processId: integer("process_id")
    .notNull()
    .references(() => processes.id),
  fileId: integer("file_id").references(() => files.id, { onDelete: "set null" }),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  closedAt: integer("closed_at"),
});

export const adminSettings = sqliteTable(
  "admin_settings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: teamId(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [unique().on(t.teamId, t.key)],
);
