import { teamKey } from "@g3/site-config";

/** Deployment secrets predate multiple teams and belong only to the original site team. */
export function teamApiKey(
  teamId: string,
  savedKey: string | null | undefined,
  legacyKey?: string,
) {
  return savedKey || (teamId === teamKey ? legacyKey || "" : "");
}
