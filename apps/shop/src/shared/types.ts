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
