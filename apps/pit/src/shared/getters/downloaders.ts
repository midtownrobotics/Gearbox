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
