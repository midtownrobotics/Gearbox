import { type InstanceRow, isObsoleteRevision, partLabel } from "./derive";
import { createBatch } from "./getters";
import type { Batch, BatchStatus, PartDefinition, PartFile } from "./types";
import type { ShopData } from "./use-shop-data";

// Batches: instances that share one file, moved as one unit through the File Producer process
// that makes it and then the File Consumer process that uses it. The worker keeps the rules
// (workers/shop/src/lib/batches.ts); this is how the pages read what it sends.

/** The instances in a batch now. */
export const batchMembers = (batch: Batch) => batch.instances.filter((i) => i.removedAt === null);

/** The instances that were sent back out of a batch. */
export const batchRemoved = (batch: Batch) => batch.instances.filter((i) => i.removedAt !== null);

export const batchComplete = (batch: Batch) =>
  batch.producerStatus === "done" && batch.consumerStatus === "done";

/** Which of its two processes a batch is at, and how far along it is there. */
export function batchStage(batch: Batch): {
  at: "producer" | "consumer";
  processId: number | null;
  status: BatchStatus;
} {
  return batch.producerStatus === "done"
    ? { at: "consumer", processId: batch.consumerProcessId, status: batch.consumerStatus }
    : { at: "producer", processId: batch.processId, status: batch.producerStatus };
}

/** "To Do at CAM", "In Progress at Router", "Complete". */
export function batchStatusText(batch: Batch, processName: (id: number) => string): string {
  if (batchComplete(batch)) return "Complete";
  const { processId, status } = batchStage(batch);
  const state = status === "doing" ? "In Progress" : "To Do";
  return processId === null ? state : `${state} at ${processName(processId)}`;
}

export const processNamer = (data: ShopData | null) => (id: number) =>
  data?.processes.find((p) => p.id === id)?.name ?? `Process #${id}`;

/**
 * The batch that moves a part's step at a process, if one does: the part is in it, and the step
 * is the batch's File Producer or File Consumer one. Such a step can't be moved on its own.
 */
export function batchAt(
  row: InstanceRow,
  processId: number,
  batchById: Map<number, Batch>,
): Batch | null {
  for (const proc of row.procs) {
    if (proc.batchId === null) continue;
    const batch = batchById.get(proc.batchId);
    if (batch && (batch.processId === processId || batch.consumerProcessId === processId)) {
      return batch;
    }
  }
  return null;
}

/** The batch that moves the step a part is on now, if one does. */
export const currentBatch = (row: InstanceRow, batchById: Map<number, Batch>) =>
  row.current ? batchAt(row, row.current.processId, batchById) : null;

export const batchesById = (batches: Batch[]) => new Map(batches.map((b) => [b.id, b]));

/** Every batch that holds, or held, an instance of a part, newest first. */
export const batchesOfPart = (definitionId: number, batches: Batch[]) =>
  batches.filter((b) => b.instances.some((i) => i.partDefinitionId === definitionId)).reverse();

/**
 * A batch's live parts, and which of them have reached its File Consumer process. It can be
 * started there once they all have.
 */
export function batchArrival(batch: Batch, rowById: Map<number, InstanceRow>) {
  const live = batchMembers(batch).flatMap((m) => rowById.get(m.partInstanceId) ?? []);
  const here = live.filter(
    (r) => r.current !== null && r.current.processId === batch.consumerProcessId,
  );
  return { live, here, all: live.length > 0 && here.length === live.length };
}

export type FileState = "not-started" | "in-progress" | "complete" | "unused" | "obsolete";

/**
 * Where a file is, from its batches at their File Consumer process (one still at its File
 * Producer process hasn't started). Unused when no batch with parts in it has the file.
 */
export function fileState(file: PartFile, batches: Batch[]): FileState {
  if (file.obsolete) return "obsolete";
  const used = batches.filter((b) => b.fileId === file.id && batchMembers(b).length > 0);
  if (used.length === 0) return "unused";
  if (used.every(batchComplete)) return "complete";
  const started = used.some((b) => b.producerStatus === "done" && b.consumerStatus !== "todo");
  return started ? "in-progress" : "not-started";
}

export type DrawingState = "not-started" | "in-progress" | "complete" | "obsolete";

export const drawingKey = (partNumber: string, revision: string) =>
  `${partNumber}\u0000${revision}`;

/** Where each drawing's part is in production, by `drawingKey`. One with no parts hasn't started. */
export function drawingStates(data: ShopData): Map<string, DrawingState> {
  const stepsByInstance = new Map<number, string[]>();
  for (const step of data.instanceProcesses) {
    const list = stepsByInstance.get(step.partInstanceId);
    if (list) list.push(step.status);
    else stepsByInstance.set(step.partInstanceId, [step.status]);
  }
  const revisions = new Map<string, PartDefinition[]>();
  for (const d of data.definitions) {
    const key = drawingKey(d.onshapePartNumber, d.revision);
    revisions.set(key, [...(revisions.get(key) ?? []), d]);
  }

  const states = new Map<string, DrawingState>();
  for (const [key, definitions] of revisions) {
    const live = definitions.filter((d) => !isObsoleteRevision(d, data.instances));
    if (live.length === 0) {
      states.set(key, "obsolete");
      continue;
    }
    const liveIds = new Set(live.map((d) => d.id));
    const steps = data.instances
      .filter((i) => liveIds.has(i.partDefinitionId) && !i.isStale)
      .map((i) => stepsByInstance.get(i.id) ?? []);
    const complete = (s: string[]) => s.length > 0 && s.every((status) => status === "done");
    const started = (s: string[]) => s.some((status) => status === "doing" || status === "done");
    states.set(
      key,
      steps.length > 0 && steps.every(complete)
        ? "complete"
        : steps.some(started)
          ? "in-progress"
          : "not-started",
    );
  }
  return states;
}

/**
 * The instances that can go in a batch now: at a File Producer process and in no batch. Priority
 * ones first, then by number. `definitionId` keeps it to one part.
 */
export function stageableRows(
  rows: InstanceRow[],
  data: ShopData,
  definitionId?: number,
): InstanceRow[] {
  const makesFiles = new Set(
    data.processes.filter((p) => p.type === "file_producer").map((p) => p.id),
  );
  return rows
    .filter(
      (r) =>
        (definitionId === undefined || r.definition.id === definitionId) &&
        r.current !== null &&
        makesFiles.has(r.current.processId) &&
        r.current.batchId === null &&
        (r.current.status === "todo" || r.current.status === "doing"),
    )
    .sort(
      (a, b) =>
        b.instance.isPriority - a.instance.isPriority ||
        a.instance.instanceNumber - b.instance.instanceNumber,
    );
}

/** Why none of a part's instances can go in a batch right now. */
export function whyNotStageable(
  rows: InstanceRow[],
  data: ShopData,
  definition: PartDefinition,
): string {
  const label = `${definition.onshapePartNumber} · Rev ${definition.revision}`;
  const own = rows.filter((r) => r.definition.id === definition.id && r.state !== "complete");
  if (own.length === 0) return `${label} has no instances in production.`;
  const makesFiles = data.processes.filter((p) => p.type === "file_producer");
  const through = makesFiles.filter((p) =>
    own.some((r) => r.procs.some((s) => s.processId === p.id)),
  );
  if (through.length === 0) return `${label} doesn't go through a File Producer process.`;
  const names = through.map((p) => p.name).join(" or ");
  return `No instance of ${label} is waiting at ${names} outside a batch. An instance joins a batch while it's there.`;
}

/**
 * Links a file to `count` of a part's instances, which makes a batch of them at the File Producer
 * process they're waiting at. Resolves to the batch, and a note when it couldn't take that many.
 */
export async function linkFileToPart(
  rows: InstanceRow[],
  data: ShopData,
  definition: PartDefinition,
  count: number,
  fileId: number,
): Promise<{ batch: Batch; notice: string | null }> {
  const free = stageableRows(rows, data, definition.id);
  const first = free[0]?.current;
  if (!first) throw new Error(whyNotStageable(rows, data, definition));
  const picked = free.filter((r) => r.current?.processId === first.processId).slice(0, count);
  const { batch, refused } = await createBatch({
    processId: first.processId,
    fileId,
    partInstanceIds: picked.map((r) => r.instance.id),
  });
  const short =
    picked.length < count
      ? `Only ${picked.length} of ${partLabel(picked[0])} ${picked.length === 1 ? "was" : "were"} waiting at ${processNamer(data)(first.processId)}, so the batch has ${picked.length === 1 ? "that one" : "those"}.`
      : null;
  return { batch, notice: [short, ...refused].filter(Boolean).join(" ") || null };
}
