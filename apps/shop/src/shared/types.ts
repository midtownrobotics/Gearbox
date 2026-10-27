/** What the team's parts are made for (a robot, a practice bot). A part's is its subsystem's. */
export type Project = {
  id: number;
  name: string;
  createdAt: number;
  /** When an admin removed it while something used it: kept for that, left out of new parts. */
  archivedAt: number | null;
};

export type Subsystem = {
  id: number;
  projectId: number;
  name: string;
  createdAt: number;
  /** When an admin removed it while parts used it: kept for them, left out of new parts. */
  archivedAt: number | null;
};

export type ProcessType = "regular" | "file_producer" | "file_consumer" | "quality_control";

export const PROCESS_TYPE_LABELS: Record<ProcessType, string> = {
  regular: "Regular",
  file_producer: "File Producer",
  file_consumer: "File Consumer",
  quality_control: "Quality Control",
};

export type Process = {
  id: number;
  name: string;
  type: ProcessType;
  /** 1 when parts using this process must record material + thickness at ingest. */
  requiresPartInfo: number;
  createdAt: number;
  /** When an admin removed it while something used it: kept for that, left out of new parts. */
  archivedAt: number | null;
};

export type PartDefinition = {
  id: number;
  onshapePartNumber: string;
  revision: string;
  subsystemId: number;
  creator: string;
  name: string;
  notes: string | null;
  partDrawingUrl: string | null;
  isObsolete: number;
  createdAt: number;
  material: string | null;
  thickness: string | null;
};

export type PartInstance = {
  id: number;
  partDefinitionId: number;
  instanceNumber: number;
  isPriority: number;
  isStale: number;
  /** When it was made obsolete and who did it; null when it isn't, or when that wasn't kept. */
  obsoletedAt: number | null;
  obsoletedBy: string | null;
  createdAt: number;
};

export type Blueprint = {
  id: number;
  partDefinitionId: number;
  processId: number;
  index: number;
  createdAt: number;
};

export type ProcessStatus = "waiting" | "todo" | "doing" | "done";

export type ActionType = "started" | "completed";

export type Action = {
  id: number;
  userId: string;
  partInstanceId: number;
  processId: number;
  action: ActionType;
  createdAt: number;
};

export type KioskPresence = {
  id: number;
  kioskDeviceId: number;
  deviceName: string;
  userId: string;
  updatedAt: number;
};

export type PartInstanceProcess = {
  id: number;
  partInstanceId: number;
  processId: number;
  index: number;
  status: ProcessStatus;
  completedAt: number | null;
  createdAt: number;
  batchId: number | null;
};

/** Where a released part and the release it came from live in Onshape. */
export type OnshapePartLink = {
  partNumber: string;
  /** The revision the release gave it, or null when its BOM never filled one. */
  revision: string | null;
  /** The part in the released version, or null when the release left no part element. */
  part: string | null;
  /** Onshape's id for the release package the part came from. */
  releaseId: string;
  /** The release package the part came from. */
  release: string;
};

/** A stored file. It reaches instances only through a batch. */
export type PartFile = {
  id: number;
  filename: string;
  contentType: string;
  fileSize: number;
  uploadedBy: string;
  createdAt: number;
  /** Made for an instance that's now obsolete: it can't go on another batch. */
  obsolete: boolean;
};

export type BatchStatus = "todo" | "doing" | "done";

/** An instance in a batch, or one that was sent back out of it (`removedAt`). */
export type BatchInstance = {
  partInstanceId: number;
  partDefinitionId: number;
  instanceNumber: number;
  removedAt: number | null;
  removedBy: string | null;
};

/**
 * Instances that share one file, moved as one unit: through the File Producer process that makes
 * the file (`producerStatus`), then the File Consumer process that uses it (`consumerStatus`,
 * which only means something once the first is done).
 */
export type Batch = {
  id: number;
  /** "Batch 7": counted up within the team. */
  number: number;
  /** The name someone gave it, or null for the automatic one. `label` is the one to show. */
  name: string | null;
  label: string;
  processId: number;
  /** Null while nothing is in it. */
  consumerProcessId: number | null;
  fileId: number | null;
  file: PartFile | null;
  producerStatus: BatchStatus;
  consumerStatus: BatchStatus;
  createdBy: string;
  createdAt: number;
  /** When it finished its File Producer process. */
  closedAt: number | null;
  /** When it finished its File Consumer process. */
  completedAt: number | null;
  instances: BatchInstance[];
};

/** What a copy of a batch would take, and whether there are enough free parts for it. */
export type DuplicatePlan = {
  ok: boolean;
  /** Why it can't be copied, when it isn't for want of parts. */
  reason: string | null;
  parts: {
    partDefinitionId: number;
    name: string | null;
    partNumber: string;
    revision: string | null;
    needed: number;
    available: number;
    partInstanceIds: number[];
    instanceNumbers: number[];
  }[];
};

/** One Onshape release, as GET /onshape/releases gives it. */
export type OnshapeRelease = {
  id: number;
  releaseId: string;
  /** The project of the document it came from; null when that wasn't known. */
  projectId: number | null;
  /** From the release package; null for releases from before it was kept. */
  name: string | null;
  notes: string | null;
  state: string | null;
  madeBy: string | null;
  madeAt: string | null;
  /** When it was approved (ISO). */
  releasedAt: string;
  approvers: { name: string; approvedAt: string | null; rejectedAt: string | null }[];
  comments: { by: string | null; message: string; at: string | null }[];
  /** The release's package in Onshape: null for the demo's sample releases. */
  links: { release: string | null; document: string | null };
  parts: {
    id: number;
    partNumber: string;
    name: string | null;
    description: string | null;
    revision: string | null;
    quantity: number | null;
    /** A later release holds this part number at another revision. */
    obsolete: boolean;
    links: { part: string | null; drawing: string | null };
  }[];
};

/** A step a failed quality report names as the likely cause, as it was when reported. */
/** One line of the checklist a report went through, and whether the part met it. */
export type QualityAnswer = { label: string; ok: boolean };

export type QualitySuspect = {
  processId: number;
  name: string;
  /** When it was last finished, and by whom (a user id); null when that wasn't recorded. */
  completedAt: number | null;
  completedBy: string | null;
};

export type QualityOutcome = "passed" | "sent_back" | "not_sent_back" | "fixed" | "replaced";

/** A quality report on a part at a Quality Control step; the part and step as they were then. */
export type QualityReport = {
  id: number;
  partInstanceId: number;
  partDefinitionId: number;
  partName: string;
  partNumber: string;
  revision: string | null;
  /** The part's project when the report was written; null for reports from before projects. */
  projectId: number | null;
  projectName: string | null;
  instanceNumber: number;
  processId: number;
  processName: string;
  reportedBy: string;
  createdAt: number;
  /** The checklist as it read when the report was written, in the team's order. */
  checks: QualityAnswer[];
  passed: number;
  unsure: number;
  suspects: QualitySuspect[];
  notes: string | null;
  outcome: QualityOutcome;
  sentBackProcessId: number | null;
  sentBackProcessName: string | null;
  sentBackStatus: "todo" | "doing" | null;
  /** What has to be done to fix the part, as written onto the part's notes. */
  fixNote: string | null;
  /** The part made to replace this one; its instance may later be deleted. */
  replacementInstanceId: number | null;
  replacementInstanceNumber: number | null;
  outcomeBy: string | null;
  outcomeAt: number | null;
};

/** How many lines a team's quality checklist can have, and how long each can be. */
export const MAX_CHECKLIST_ITEMS = 20;
export const MAX_CHECK_LABEL = 120;

/** How many parts use a subsystem or process, and whether anything at all does. */
export type Usage = { parts: number; inUse: boolean };

/** What removing one did: deleted (nothing used it) or archived (hidden from new parts). */
export type Removal = { outcome: "deleted" | "archived"; name: string; parts: number };

/** Leaves out subsystems or processes removed on Admin, except the ones already chosen. */
export function activeOr<T extends { id: number; archivedAt: number | null }>(
  items: T[],
  chosen: number[] = [],
): T[] {
  return items.filter((item) => item.archivedAt === null || chosen.includes(item.id));
}
