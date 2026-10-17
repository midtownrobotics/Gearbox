import { api } from "../api";

// AdvantageScope Lite, which Pit serves at /scope/ (workers/pit/src/advantagescope.ts).

/** A field, robot or joystick the team uploaded in AdvantageScope. */
export type ScopeAsset = { name: string; size: number; uploadedAt: number };

/** AdvantageScope, opening this match log when it's given (by its event and name). */
export const advantageScopeUrl = (log?: { event: string; name: string }) =>
  log ? `/scope/?log=${encodeURIComponent(`${log.event}_${log.name}.wpilog`)}` : "/scope/";

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
