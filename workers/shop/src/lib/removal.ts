import { inTeam } from "@g3/auth";
import { and, count, eq, isNull } from "drizzle-orm";
import type { createShopDb } from "../db";
import {
  actions,
  partDefinitionProcessBlueprints,
  partDefinitions,
  partInstanceProcesses,
  partInstances,
  processes,
  stagingBatches,
  subsystems,
} from "../db/schema";
import { forgetQualityCheck, qualityCheck } from "./quality";

// Removing a subsystem or process the team no longer uses. Nothing in use is ever deleted or
// broken: one nothing points at is deleted, and one that parts, instances, batches or the Actions
// Log still name is archived (`archived_at`) instead. An archived one is left out of every picker
// for new parts and refused for them (`removedError`), while what already uses it keeps it and
// shows its name. Restoring clears it.

type ShopDb = ReturnType<typeof createShopDb>;

/** How many parts use it, and whether anything at all does (a batch or a log line may alone). */
export type Usage = { parts: number; inUse: boolean };

/** Every subsystem's usage that has any: the parts filed under it. */
export async function subsystemUsage(db: ShopDb, teamId: string): Promise<Map<number, Usage>> {
  const rows = await db
    .select({ id: partDefinitions.subsystemId, parts: count() })
    .from(partDefinitions)
    .where(inTeam(partDefinitions, teamId))
    .groupBy(partDefinitions.subsystemId)
    .all();
  return new Map(rows.map((r) => [r.id, { parts: r.parts, inUse: r.parts > 0 }]));
}

/**
 * Every process's usage that has any: the parts it's a step of (in their blueprints, or on any
 * of their instances), and whether a batch or the Actions Log names it.
 */
export async function processUsage(db: ShopDb, teamId: string): Promise<Map<number, Usage>> {
  const [blueprints, steps, batches, logged] = await Promise.all([
    db
      .selectDistinct({
        processId: partDefinitionProcessBlueprints.processId,
        part: partDefinitionProcessBlueprints.partDefinitionId,
      })
      .from(partDefinitionProcessBlueprints)
      .where(inTeam(partDefinitionProcessBlueprints, teamId))
      .all(),
    db
      .selectDistinct({
        processId: partInstanceProcesses.processId,
        part: partInstances.partDefinitionId,
      })
      .from(partInstanceProcesses)
      .innerJoin(partInstances, eq(partInstances.id, partInstanceProcesses.partInstanceId))
      .where(and(inTeam(partInstanceProcesses, teamId), inTeam(partInstances, teamId)))
      .all(),
    db
      .select({
        processId: stagingBatches.processId,
        consumerProcessId: stagingBatches.consumerProcessId,
      })
      .from(stagingBatches)
      .where(inTeam(stagingBatches, teamId))
      .all(),
    db
      .selectDistinct({ processId: actions.processId })
      .from(actions)
      .where(inTeam(actions, teamId))
      .all(),
  ]);

  const parts = new Map<number, Set<number>>();
  for (const { processId, part } of [...blueprints, ...steps]) {
    parts.set(processId, (parts.get(processId) ?? new Set()).add(part));
  }
  const used = new Set<number>([
    ...parts.keys(),
    ...batches.flatMap((b) => [b.processId, b.consumerProcessId ?? b.processId]),
    ...logged.map((l) => l.processId),
  ]);
  return new Map([...used].map((id) => [id, { parts: parts.get(id)?.size ?? 0, inUse: true }]));
}

export type Removal =
  | { outcome: "deleted" | "archived"; name: string; parts: number }
  | { error: string; status: 404 | 409 };

/**
 * Deletes the row when nothing uses it, else archives it. A delete that fails anyway (something
 * started using it a moment ago, and its foreign key says so) archives instead.
 */
async function deleteOrArchive(
  inUse: boolean,
  remove: () => Promise<unknown>,
  archive: () => Promise<unknown>,
): Promise<"deleted" | "archived"> {
  if (!inUse) {
    try {
      await remove();
      return "deleted";
    } catch {
      // Fall through: it's in use after all.
    }
  }
  await archive();
  return "archived";
}

export async function removeSubsystem(db: ShopDb, teamId: string, id: number): Promise<Removal> {
  const row = await db
    .select({ name: subsystems.name })
    .from(subsystems)
    .where(inTeam(subsystems, teamId, eq(subsystems.id, id)))
    .get();
  if (!row) return { error: "Subsystem not found.", status: 404 };

  const usage = (await subsystemUsage(db, teamId)).get(id);
  const outcome = await deleteOrArchive(
    usage?.inUse ?? false,
    () => db.delete(subsystems).where(inTeam(subsystems, teamId, eq(subsystems.id, id))),
    () =>
      db
        .update(subsystems)
        .set({ archivedAt: Date.now() })
        .where(inTeam(subsystems, teamId, eq(subsystems.id, id), isNull(subsystems.archivedAt))),
  );
  return { outcome, name: row.name, parts: usage?.parts ?? 0 };
}

export async function removeProcess(db: ShopDb, teamId: string, id: number): Promise<Removal> {
  const row = await db
    .select({ name: processes.name })
    .from(processes)
    .where(inTeam(processes, teamId, eq(processes.id, id)))
    .get();
  if (!row) return { error: "Process not found.", status: 404 };

  // Every part ends with the required check, so it can't go while the team requires it.
  const check = await qualityCheck(db, teamId);
  if (check.required && check.processId === id) {
    return {
      error: `${row.name} is the team's required quality check. Turn off "Require quality control" first.`,
      status: 409,
    };
  }

  const usage = (await processUsage(db, teamId)).get(id);
  // Chosen for the check but not required: the choice goes with it.
  await forgetQualityCheck(db, teamId, id);
  const outcome = await deleteOrArchive(
    usage?.inUse ?? false,
    () => db.delete(processes).where(inTeam(processes, teamId, eq(processes.id, id))),
    () =>
      db
        .update(processes)
        .set({ archivedAt: Date.now() })
        .where(inTeam(processes, teamId, eq(processes.id, id), isNull(processes.archivedAt))),
  );
  return { outcome, name: row.name, parts: usage?.parts ?? 0 };
}

/** Says why these can't be given to a new part, or null: some were removed on the Admin page. */
export function removedError(
  kind: "subsystem" | "process",
  removed: { name: string }[],
): string | null {
  if (removed.length === 0) return null;
  const names = removed.map((r) => r.name).join(", ");
  return `${names} ${removed.length === 1 ? "was" : "were"} removed on the Admin page. Pick another ${kind}.`;
}
