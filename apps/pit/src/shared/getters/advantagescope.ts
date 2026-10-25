import { api } from "../api";

// AdvantageScope Lite, which Pit serves at /scope/ (workers/pit/src/advantagescope.ts) and shows
// on its AdvantageScope page (plugins/logs/advantagescope-page.tsx).

/** A field, robot or joystick the team uploaded in AdvantageScope. */
export type ScopeAsset = { name: string; size: number; uploadedAt: number };

/** A match log's file name in AdvantageScope ("gagai1_Qual-18.wpilog"). */
export const scopeLogFile = (log: { event: string; name: string }) =>
  `${log.event}_${log.name}.wpilog`;

/** Pit's AdvantageScope page, opening this match log when it's given. */
export const advantageScopePage = (log?: { event: string; name: string }) =>
  log
    ? `/logs/advantagescope?log=${encodeURIComponent(scopeLogFile(log))}`
    : "/logs/advantagescope";

/** AdvantageScope itself, on its own, opening this log file when it's given. */
export const scopeUrl = (file?: string) =>
  file ? `/scope/?log=${encodeURIComponent(file)}` : "/scope/";

/** The assets the team uploaded in AdvantageScope. */
export async function fetchScopeAssets(): Promise<{
  assets: ScopeAsset[];
  canManage: boolean;
  limit: number;
}> {
  const res = await api.scope["asset-list"].$get();
  if (!res.ok) throw new Error(`Failed to fetch AdvantageScope's assets (${res.status})`);
  return res.json();
}

export async function removeScopeAsset(name: string): Promise<void> {
  const res = await api.scope.assets[":name"].$delete({ param: { name } });
  if (!res.ok) throw new Error(`Failed to remove the asset (${res.status})`);
}
