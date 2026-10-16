import { api } from "../api";

/** A computer running the pit log downloader, paired with the team's Pit. */
export type LogDownloader = {
  id: number;
  name: string;
  /** The key's last four characters. */
  keyHint: string;
  pairedByName: string;
  /** Milliseconds. */
  pairedAt: number;
  lastSeenAt: number | null;
};

/** The team's paired downloaders, and whether the user may pair and remove them. */
export async function fetchDownloaders(): Promise<{
  downloaders: LogDownloader[];
  canManage: boolean;
}> {
  const res = await api.downloaders.$get();
  if (!res.ok) throw new Error(`Failed to fetch log downloaders (${res.status})`);
  return res.json() as Promise<{ downloaders: LogDownloader[]; canManage: boolean }>;
}

/** A new pairing code for the team (mentors and admins), replacing any before it. */
export async function createPairingCode(): Promise<{ code: string; expiresAt: number }> {
  const res = await api.downloaders.codes.$post();
  if (!res.ok) throw new Error(`Failed to get a pairing code (${res.status})`);
  return res.json() as Promise<{ code: string; expiresAt: number }>;
}

export async function removeDownloader(id: number): Promise<void> {
  const res = await api.downloaders[":id"].$delete({ param: { id: String(id) } });
  if (!res.ok) throw new Error(`Failed to remove the log downloader (${res.status})`);
}

/** A match log a downloader uploaded. */
export type MatchLog = {
  id: number;
  /** As AdvantageKit names the event ("archimedes"). */
  event: string;
  /** "Qual-13", "Elim-2", "Prct-0". */
  name: string;
  matchType: "q" | "e" | "p";
  matchNumber: number;
  /** Bytes. */
  size: number;
  downloaderName: string;
  uploadedAt: number | null;
};

/** The team's match logs, newest first, and whether the user may delete them. */
export async function fetchMatchLogs(): Promise<{ logs: MatchLog[]; canDelete: boolean }> {
  const res = await api.logs.$get();
  if (!res.ok) throw new Error(`Failed to fetch match logs (${res.status})`);
  return res.json() as Promise<{ logs: MatchLog[]; canDelete: boolean }>;
}

/** Where a log downloads from. */
export const matchLogFileUrl = (id: number) =>
  api.logs[":id"].file.$url({ param: { id: String(id) } }).toString();

export async function deleteMatchLog(id: number): Promise<void> {
  const res = await api.logs[":id"].$delete({ param: { id: String(id) } });
  if (!res.ok) throw new Error(`Failed to delete the log (${res.status})`);
}
