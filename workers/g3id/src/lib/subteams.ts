// SPDX-License-Identifier: AGPL-3.0-only
import { and, asc, eq } from "drizzle-orm";
import { validator } from "hono/validator";
import type { createDb } from "../db";
import { subteams, teamSubteamSettings } from "../db/schema";

// A team's subteams (migration 0023): its admins switch them on and name them on the Subteams
// page of the team's admin pages. Each member is in one or none (core_users.subteam_id), chosen
// when they join (the name step of a sign-up) or on their Account page, and changed by an admin
// on their page in Members. Switched off, nobody is asked and nothing shows, but who's in which
// is kept for when they're switched on again.

type Db = ReturnType<typeof createDb>;

/** The longest name a subteam can have. */
export const SUBTEAM_NAME_MAX = 40;
/** The most subteams a team can have. */
export const SUBTEAMS_MAX = 30;

export type Subteam = { id: string; name: string };

/** A subteam's name as entered, trimmed and with runs of spaces made one; null when it isn't one. */
export function cleanSubteamName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= SUBTEAM_NAME_MAX ? name : null;
}

export async function subteamsEnabled(db: Db, teamId: string): Promise<boolean> {
  const row = await db
    .select({ enabled: teamSubteamSettings.enabled })
    .from(teamSubteamSettings)
    .where(eq(teamSubteamSettings.teamId, teamId))
    .get();
  return row?.enabled === 1;
}

export async function saveSubteamsEnabled(
  db: Db,
  teamId: string,
  enabled: boolean,
  userId: string,
) {
  const values = {
    enabled: enabled ? 1 : 0,
    updatedAt: Math.floor(Date.now() / 1000),
    updatedBy: userId,
  };
  await db
    .insert(teamSubteamSettings)
    .values({ teamId, ...values })
    .onConflictDoUpdate({ target: teamSubteamSettings.teamId, set: values });
}

/** The team's subteams, by name. */
export function listSubteams(db: Db, teamId: string): Promise<Subteam[]> {
  return db
    .select({ id: subteams.id, name: subteams.name })
    .from(subteams)
    .where(eq(subteams.teamId, teamId))
    .orderBy(asc(subteams.name))
    .all();
}

/** Whether subteams are on and which there are, for pages that let someone choose one. */
export async function teamSubteams(db: Db, teamId: string) {
  const [enabled, list] = await Promise.all([
    subteamsEnabled(db, teamId),
    listSubteams(db, teamId),
  ]);
  return { enabled, subteams: list };
}

/** The team's subteam with this id, or null when it has none. */
export function findSubteam(db: Db, teamId: string, id: string) {
  return db
    .select({ id: subteams.id, name: subteams.name })
    .from(subteams)
    .where(and(eq(subteams.teamId, teamId), eq(subteams.id, id)))
    .get();
}

/**
 * A subteam someone chose, read from a request's `subteamId`: the team's subteam, `null` for none,
 * or "invalid" when it isn't one of the team's (or subteams are off and one was given).
 */
export async function chosenSubteam(
  db: Db,
  teamId: string,
  value: unknown,
): Promise<Subteam | null | "invalid"> {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return "invalid";
  if (!(await subteamsEnabled(db, teamId))) return "invalid";
  return (await findSubteam(db, teamId, value)) ?? "invalid";
}

/** A request choosing a subteam: `{ subteamId: string | null }` (checked by `chosenSubteam`). */
export const subteamBody = validator("json", (value, c) => {
  const subteamId = (value as { subteamId?: unknown } | null)?.subteamId ?? null;
  if (subteamId !== null && typeof subteamId !== "string") {
    return c.json({ error: "Choose one of your team's subteams." }, 400);
  }
  return { subteamId: subteamId as string | null };
});
