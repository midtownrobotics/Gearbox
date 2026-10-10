export type BatteryState = "Charging" | "In Robot" | "Idle" | "Broken" | "Next Up";

export type Battery = {
  id: number;
  name: string;
  state: BatteryState;
  stateSince: number; // ms timestamp
  voltage: number | null;
  useCount: number;
  createdAt: number;
};

export type ChecklistList = {
  id: number;
  name: string;
  description: string | null;
  createdAt: number;
  itemCount: number;
  checkedCount: number;
};

export type ChecklistItem = {
  id: number;
  listId: number;
  index: number;
  type: "item" | "topic";
  name: string;
  description: string | null;
  checked: boolean;
  createdAt: number;
};

export type ChecklistIssue = {
  id: number;
  itemId: number;
  text: string;
  createdAt: number;
};

export type ChecklistIssueSummary = ChecklistIssue & {
  itemName: string;
  listId: number;
  listName: string;
};

export type ArchiveType = "match" | "practice" | "other";

export const ARCHIVE_TYPE_LABELS: Record<ArchiveType, string> = {
  match: "Match",
  practice: "Practice",
  other: "Other",
};

/** An archive of the checklists as the Logs page lists it. */
export type ChecklistArchive = {
  id: number;
  event: string;
  type: ArchiveType;
  details: string;
  archivedAt: number; // seconds
  archivedByName: string;
};

/**
 * How an issue stood when the checklists were archived: "new" was reported since the archive
 * before and is open, "open" was already open then and still is, "resolved" was resolved since
 * the archive before, whenever it was reported.
 */
export type ArchivedIssueStatus = "new" | "open" | "resolved";

export type ArchivedIssue = {
  id: number;
  text: string;
  createdAt: number;
  status: ArchivedIssueStatus;
};

export type ArchivedItem = {
  id: number;
  type: "item" | "topic";
  name: string;
  description: string | null;
  checked: boolean;
  issues: ArchivedIssue[];
};

export type ArchivedList = {
  id: number;
  name: string;
  description: string | null;
  items: ArchivedItem[];
};

/** One archive with everything that was in the checklists. */
export type ChecklistArchiveDetail = ChecklistArchive & { snapshot: { lists: ArchivedList[] } };

/** What the Archive pop-up starts with: the event the team is at ("" for none). */
export type ArchiveDefaults = { event: string };
