import { inTeam } from "@g3/auth";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { createShopDb } from "../db";
import { processes, shopManagers } from "../db/schema";
import { SETTING, getSettings, setSetting } from "./settings";

// Quality Control steps (`processes.type`): a step that only the team's shop managers, and its
// admins, may mark complete, after checking the part. A team can also require quality control,
// which puts one chosen Quality Control step at the end of every part's pipeline, and turn on
// quality reports, which finish a Quality Control step with a report instead (routes/quality-reports.ts).

type ShopDb = ReturnType<typeof createShopDb>;

/** The team's quality check: whether every part ends with one, and which process it is. */
export type QualityCheck = { required: boolean; processId: number | null };

export async function qualityCheck(db: ShopDb, teamId: string): Promise<QualityCheck> {
  const values = await getSettings(db, teamId, [
    SETTING.qualityCheckRequired,
    SETTING.qualityCheckProcess,
  ]);
  const processId = Number(values.get(SETTING.qualityCheckProcess));
  return {
    required: values.get(SETTING.qualityCheckRequired) === "1",
    processId: Number.isInteger(processId) && processId > 0 ? processId : null,
  };
}

/** Whether the team finishes its Quality Control steps with quality reports. */
export async function qualityReportsOn(db: ShopDb, teamId: string): Promise<boolean> {
  return (
    (await getSettings(db, teamId, [SETTING.qualityReports])).get(SETTING.qualityReports) === "1"
  );
}

/**
 * Whether this person may sign off a Quality Control step: an admin, or one of the team's shop
 * managers. An admin signed in on a kiosk counts only if they're on the list, since a kiosk PIN
 * session carries no roles.
 */
export async function canQualityCheck(
  db: ShopDb,
  teamId: string,
  user: { id: string; isAdmin: boolean },
): Promise<boolean> {
  return user.isAdmin || isShopManager(db, teamId, user.id);
}

/** Whether this person is one of the team's shop managers. */
export async function isShopManager(db: ShopDb, teamId: string, userId: string): Promise<boolean> {
  const row = await db
    .select({ id: shopManagers.id })
    .from(shopManagers)
    .where(inTeam(shopManagers, teamId, eq(shopManagers.userId, userId)))
    .get();
  return Boolean(row);
}

/** The team's Quality Control processes, oldest first, leaving out ones removed on Admin. */
export function qualityProcesses(db: ShopDb, teamId: string) {
  return db
    .select({ id: processes.id, name: processes.name })
    .from(processes)
    .where(
      inTeam(
        processes,
        teamId,
        eq(processes.type, "quality_control"),
        isNull(processes.archivedAt),
      ),
    )
    .all();
}

/** The names of the Quality Control steps among these processes. */
async function qualityStepNames(db: ShopDb, teamId: string, processIds: number[]) {
  const ids = [...new Set(processIds)];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ name: processes.name })
    .from(processes)
    .where(
      inTeam(processes, teamId, inArray(processes.id, ids), eq(processes.type, "quality_control")),
    )
    .all();
  return rows.map((r) => r.name);
}

/**
 * Why this person can't mark these steps complete, or null: a Quality Control step is for the
 * team's shop managers and its admins only, and while the team has quality reports on, it's
 * finished by a report and no other way.
 */
export async function qualityCheckBlock(
  db: ShopDb,
  teamId: string,
  user: { id: string; isAdmin: boolean },
  processIds: number[],
): Promise<string | null> {
  const names = await qualityStepNames(db, teamId, processIds);
  if (names.length === 0) return null;
  const steps = names.join(" and ");
  if (await qualityReportsOn(db, teamId)) {
    return `Quality reports are on: ${steps} ${names.length > 1 ? "are" : "is"} finished with a quality report.`;
  }
  if (await canQualityCheck(db, teamId, user)) return null;
  return `${steps} ${names.length > 1 ? "are quality checks" : "is a quality check"}: only a shop manager can mark ${names.length > 1 ? "them" : "it"} complete.`;
}

/**
 * The pipeline a part gets: with a quality check required, the team's chosen step goes last,
 * wherever it was asked for. Left as given when nothing is required, or the process is gone.
 */
export async function withQualityStep(
  db: ShopDb,
  teamId: string,
  processIds: number[],
): Promise<number[]> {
  const { required, processId } = await qualityCheck(db, teamId);
  if (!required || processId === null) return processIds;
  const step = await db
    .select({ id: processes.id })
    .from(processes)
    .where(
      inTeam(
        processes,
        teamId,
        and(eq(processes.id, processId), eq(processes.type, "quality_control")),
      ),
    )
    .get();
  if (!step) return processIds;
  return [...processIds.filter((id) => id !== processId), processId];
}

/**
 * Drops the team's required quality check when this process is it: it isn't a Quality Control
 * step any more, so nothing would be appended and the setting would only mislead.
 */
export async function forgetQualityCheck(db: ShopDb, teamId: string, processId: number) {
  const check = await qualityCheck(db, teamId);
  if (check.processId !== processId) return;
  await setSetting(db, teamId, SETTING.qualityCheckRequired, "");
  await setSetting(db, teamId, SETTING.qualityCheckProcess, "");
}

/**
 * Saves the team's quality check. Gives back a reason to refuse it (said to the admin) when the
 * process isn't one of the team's Quality Control steps, or a required check names none.
 */
export async function saveQualityCheck(
  db: ShopDb,
  teamId: string,
  next: QualityCheck,
): Promise<string | undefined> {
  if (next.processId !== null) {
    const step = await db
      .select({ id: processes.id })
      .from(processes)
      .where(
        inTeam(
          processes,
          teamId,
          and(
            eq(processes.id, next.processId),
            eq(processes.type, "quality_control"),
            isNull(processes.archivedAt),
          ),
        ),
      )
      .get();
    if (!step) return "Pick a Quality Control process that hasn't been removed.";
  }
  if (next.required && next.processId === null) {
    return "Pick the Quality Control process the check uses.";
  }
  await setSetting(db, teamId, SETTING.qualityCheckRequired, next.required ? "1" : "");
  await setSetting(
    db,
    teamId,
    SETTING.qualityCheckProcess,
    next.processId === null ? "" : String(next.processId),
  );
}
