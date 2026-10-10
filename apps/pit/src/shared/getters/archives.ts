import { api } from "../api";
import {
  ARCHIVE_TYPE_LABELS,
  type ArchiveDefaults,
  type ArchiveType,
  type ChecklistArchive,
  type ChecklistArchiveDetail,
} from "./types";

/** `event - Type - details`, leaving out a part that's empty. */
export function archiveTitle(archive: Pick<ChecklistArchive, "event" | "type" | "details">) {
  return [archive.event, ARCHIVE_TYPE_LABELS[archive.type], archive.details]
    .filter(Boolean)
    .join(" - ");
}

export async function fetchArchiveDefaults(): Promise<ArchiveDefaults> {
  const res = await api.archives.defaults.$get();
  if (!res.ok) throw new Error(`Failed to fetch archive defaults (${res.status})`);
  return res.json() as Promise<ArchiveDefaults>;
}

/** The team's next official match at its event, "" when nobody can say. */
export async function fetchNextMatch(): Promise<string> {
  const res = await api.archives["next-match"].$get();
  if (!res.ok) throw new Error(`Failed to fetch the next match (${res.status})`);
  return ((await res.json()) as { nextMatch: string }).nextMatch;
}

/** A page of archives, newest first; `before` is the last id of the page before. */
export async function fetchArchives(
  before?: number,
): Promise<{ archives: ChecklistArchive[]; more: boolean }> {
  const res = await api.archives.$get({ query: { before: before ? String(before) : undefined } });
  if (!res.ok) throw new Error(`Failed to fetch archives (${res.status})`);
  return res.json() as Promise<{ archives: ChecklistArchive[]; more: boolean }>;
}

export async function fetchArchive(id: number): Promise<ChecklistArchiveDetail> {
  const res = await api.archives[":id"].$get({ param: { id: String(id) } });
  if (!res.ok) throw new Error(`Failed to fetch archive (${res.status})`);
  return res.json() as Promise<ChecklistArchiveDetail>;
}

/** Archives the checklists as they stand and unchecks every item. */
export function createArchive(body: { event: string; type: ArchiveType; details: string }) {
  return api.archives.$post({ json: body });
}
