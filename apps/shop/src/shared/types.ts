export type Subsystem = {
  id: number;
  name: string;
  createdAt: number;
};

export type ProcessType = "regular" | "file_producer" | "file_consumer";

export const PROCESS_TYPE_LABELS: Record<ProcessType, string> = {
  regular: "Regular",
  file_producer: "File Producer",
  file_consumer: "File Consumer",
};

export type Process = {
  id: number;
  name: string;
  type: ProcessType;
  /** 1 when parts using this process must record material + thickness at ingest. */
  requiresPartInfo: number;
  createdAt: number;
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
  links: { release: string; document: string | null };
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
