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
  /** Bytes as stored, gzipped. */
  size: number;
  /** The .wpilog's own bytes. */
  rawSize: number | null;
  /** Cut to part of the match on the downloader. */
  trimmed: boolean;
  downloaderName: string;
  uploadedAt: number | null;
};

/** What Pit does with a new log once the team has `limit`. */
export type WhenFull = "skip-new" | "delete-oldest";

export type MatchLogs = {
  logs: MatchLog[];
  /** The most logs Pit keeps for a team. */
  limit: number;
  whenFull: WhenFull;
  /** Mentors and admins: delete logs and choose `whenFull`. */
  canManage: boolean;
};

/** The team's match logs, newest first. */
export async function fetchMatchLogs(): Promise<MatchLogs> {
  const res = await api.logs.$get();
  if (!res.ok) throw new Error(`Failed to fetch match logs (${res.status})`);
  return res.json() as Promise<MatchLogs>;
}

/**
 * The API's base for a link (an <a href>). Not the client's `$url()`: it builds a URL object, and
 * the base is "/api" in production, which isn't a whole address on its own.
 */
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

/** Where a log downloads from, as a .wpilog. */
export const matchLogFileUrl = (id: number) => `${apiBase}/logs/${id}/file`;

/** Where every log downloads from, as one zip. */
export const matchLogsZipUrl = () => `${apiBase}/logs/export.zip`;

export async function deleteMatchLog(id: number): Promise<void> {
  const res = await api.logs[":id"].$delete({ param: { id: String(id) } });
  if (!res.ok) throw new Error(`Failed to delete the log (${res.status})`);
}

/** Deletes these logs (after an export, the ones it held). */
export async function deleteMatchLogs(ids: number[]): Promise<void> {
  const res = await api.logs.$delete(
    {},
    { init: { body: JSON.stringify({ ids }), headers: { "Content-Type": "application/json" } } },
  );
  if (!res.ok) throw new Error(`Failed to delete the logs (${res.status})`);
}

export async function setWhenFull(whenFull: WhenFull): Promise<void> {
  const res = await api.logs.settings.$put(
    {},
    {
      init: { body: JSON.stringify({ whenFull }), headers: { "Content-Type": "application/json" } },
    },
  );
  if (!res.ok) throw new Error(`Failed to save (${res.status})`);
}
