export type Subsystem = {
  id: number;
  name: string;
  createdAt: number;
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

/** An open staging batch at a File Producer process and the instances staged in it. */
export type StagingBatch = {
  id: number;
  processId: number;
  fileId: number | null;
  createdBy: string;
  createdAt: number;
  partInstanceIds: number[];
};

export type FileAssignment = {
  partInstanceId: number;
  partDefinitionId: number;
  instanceNumber: number;
};

/** A stored file and the instances it covers (possibly none, across any parts). */
export type PartFile = {
  id: number;
  filename: string;
  contentType: string;
  fileSize: number;
  uploadedBy: string;
  createdAt: number;
  assignments: FileAssignment[];
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
