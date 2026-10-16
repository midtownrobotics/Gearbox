import { inTeam, withTeam } from "@g3/auth";
import type { EdgeDb } from "../../db";
import { edgeStatus, netSettings } from "../../db/schema";
import { DEFAULT_TIME_ZONE, isTimeZone } from "../../lib/time";

/** The team's network settings, made with the defaults (no cap, cycles from the 1st) if new. */
export async function getSettings(db: EdgeDb, teamId: string) {
  const settings = await db.select().from(netSettings).where(inTeam(netSettings, teamId)).get();
  if (settings) return settings;
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(netSettings)
    .values(withTeam(teamId, { capBytes: 0, cycleStartDay: 1, updatedAt: now }))
    .onConflictDoNothing();
  const made = await db.select().from(netSettings).where(inTeam(netSettings, teamId)).get();
  if (!made) throw new Error("net_settings row missing");
  return made;
}

/** The time zone the team's box is set to (UTC until it has said). */
export async function teamTimeZone(db: EdgeDb, teamId: string) {
  const row = await db
    .select({ timeZone: edgeStatus.timeZone })
    .from(edgeStatus)
    .where(inTeam(edgeStatus, teamId))
    .get();
  return row?.timeZone && isTimeZone(row.timeZone) ? row.timeZone : DEFAULT_TIME_ZONE;
}

export const clientName = (c: {
  mac: string;
  displayName: string | null;
  hostname: string | null;
}) => c.displayName ?? c.hostname ?? c.mac;
