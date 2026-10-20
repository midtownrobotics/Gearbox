import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import type { ReleaseApprover, ReleaseComment } from "../lib/onshape-release";

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

export const PROCESS_TYPES = [
  "regular",
  "file_producer",
  "file_consumer",
  "quality_control",
] as const;
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

/**
 * The team's shop managers: who may check off its Quality Control steps. The team's G3ID admins
 * may too, without a row here (but not from a kiosk, where G3ID reports no roles).
 */
export const shopManagers = sqliteTable(
  "shop_managers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: teamId(),
    /** Their G3ID user id. */
    userId: text("user_id").notNull(),
    addedBy: text("added_by").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [unique().on(t.teamId, t.userId)],
);

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
    // On a File Producer step: the batch this instance is in. Cleared when it leaves the batch.
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
    // From the release package (lib/onshape-release.ts); null until it's been read.
    name: text("name"),
    notes: text("notes"),
    state: text("state"),
    documentId: text("document_id"),
    versionId: text("version_id"),
    madeBy: text("made_by"),
    madeAt: text("made_at"),
    approvers: text("approvers", { mode: "json" }).$type<ReleaseApprover[]>(),
    comments: text("comments", { mode: "json" }).$type<ReleaseComment[]>(),
    detailsAt: integer("details_at"),
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
  // Set for good when an obsolete instance it was made for is deleted, so the file stays
  // obsolete. Until then that is worked out from its batches (lib/batches.ts).
  obsoletedAt: integer("obsoleted_at"),
});

export const BATCH_STATUSES = ["todo", "doing", "done"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/**
 * Instances that share one file, moved as one unit: first through the File Producer process that
 * makes the file (`producerStatus`), then through the File Consumer process that uses it
 * (`consumerStatus`). An instance is in a batch while its step at `processId` carries the batch's
 * id (`partInstanceProcesses.batchId`); a batch is the only thing that links an instance to a
 * file. Rules in lib/batches.ts.
 */
export const stagingBatches = sqliteTable(
  "staging_batches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: teamId(),
    /** "Batch 7": counted up within the team. */
    number: integer("number").notNull(),
    /** The name someone gave it; null for the automatic one (lib/batches.ts `batchLabel`). */
    name: text("name"),
    /** The File Producer process it was made at. */
    processId: integer("process_id")
      .notNull()
      .references(() => processes.id),
    /** The File Consumer process its parts go to next. Null while nothing is in it. */
    consumerProcessId: integer("consumer_process_id").references(() => processes.id),
    fileId: integer("file_id").references(() => files.id, { onDelete: "set null" }),
    producerStatus: text("producer_status", { enum: BATCH_STATUSES }).notNull().default("todo"),
    /** Only means something once `producerStatus` is done. */
    consumerStatus: text("consumer_status", { enum: BATCH_STATUSES }).notNull().default("todo"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    /** When it finished its File Producer process. */
    closedAt: integer("closed_at"),
    /** When it finished its File Consumer process. */
    completedAt: integer("completed_at"),
  },
  (t) => [unique().on(t.teamId, t.number)],
);

/** An instance that was sent back out of a batch after its file was made: kept as a record. */
export const stagingBatchRemovals = sqliteTable("staging_batch_removals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  batchId: integer("batch_id")
    .notNull()
    .references(() => stagingBatches.id, { onDelete: "cascade" }),
  partInstanceId: integer("part_instance_id")
    .notNull()
    .references(() => partInstances.id, { onDelete: "cascade" }),
  removedBy: text("removed_by").notNull(),
  removedAt: integer("removed_at").notNull(),
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

export const QUALITY_OUTCOMES = [
  "passed",
  "sent_back",
  "not_sent_back",
  // Sent to a step with a note on the part saying what to do, and obsoleted for a new part.
  "fixed",
  "replaced",
] as const;
export type QualityOutcome = (typeof QUALITY_OUTCOMES)[number];

/** One line of the checklist a report went through, and whether the part met it. */
export type QualityAnswer = { label: string; ok: boolean };

/** The team's quality checklist: what every report is answered against, in order. */
export const qualityCheckItems = sqliteTable("quality_check_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  label: text("label").notNull(),
  position: integer("position").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** A step a failed quality report names as the likely cause, as it was when reported. */
export type QualitySuspect = {
  processId: number;
  name: string;
  /** When the step was last finished, and by whom (a G3ID user id); null when not recorded. */
  completedAt: number | null;
  completedBy: string | null;
};

/**
 * A quality report on a part at a Quality Control step. It keeps the part and step as they were,
 * with no foreign keys, so it outlives obsolete instances deleted from the Admin page.
 */
export const qualityReports = sqliteTable("quality_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: teamId(),
  partInstanceId: integer("part_instance_id").notNull(),
  partDefinitionId: integer("part_definition_id").notNull(),
  partName: text("part_name").notNull(),
  partNumber: text("part_number").notNull(),
  revision: text("revision"),
  instanceNumber: integer("instance_number").notNull(),
  processId: integer("process_id").notNull(),
  processName: text("process_name").notNull(),
  reportedBy: text("reported_by").notNull(),
  createdAt: integer("created_at").notNull(),
  /** The checklist as it read when the report was written, in the team's order. */
  checks: text("checks", { mode: "json" }).$type<QualityAnswer[]>().notNull().default([]),
  passed: integer("passed").notNull(),
  unsure: integer("unsure").notNull().default(0),
  suspects: text("suspects", { mode: "json" }).$type<QualitySuspect[]>().notNull().default([]),
  notes: text("notes"),
  outcome: text("outcome", { enum: QUALITY_OUTCOMES }).notNull(),
  sentBackProcessId: integer("sent_back_process_id"),
  sentBackProcessName: text("sent_back_process_name"),
  sentBackStatus: text("sent_back_status", { enum: ["todo", "doing"] }),
  /** What has to be done to fix the part, as written onto the part's notes. */
  fixNote: text("fix_note"),
  /** The part made to replace this one; its instance may later be deleted. */
  replacementInstanceId: integer("replacement_instance_id"),
  replacementInstanceNumber: integer("replacement_instance_number"),
  outcomeBy: text("outcome_by"),
  outcomeAt: integer("outcome_at"),
});
