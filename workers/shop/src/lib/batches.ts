import { inTeam, withTeam } from "@g3/auth";
import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  or,
} from "drizzle-orm";
import type { ShopDb } from "../db";
import {
  type ProcessType,
  actions,
  files,
  partDefinitions,
  partInstanceProcesses,
  partInstances,
  processes,
  stagingBatchRemovals,
  stagingBatches,
} from "../db/schema";
import { finished, promoteNextSteps } from "./steps";

// Batches: instances that share one file, moved as one unit.
//
// - A batch is made at a File Producer process, by hand or by linking a file to instances. It is
//   the only thing that links an instance to a file. A part can also go through a File Producer
//   process on its own, with no batch and no file.
// - It is not started, in progress or complete at that process as a whole (`producerStatus`), and
//   then at the File Consumer process its parts go to next (`consumerStatus`). Its instances' own
//   steps follow it, so nothing moves one of them there on its own (`governingBatch`).
// - An instance joins a batch while it is at the File Producer process, and takes on the batch's
//   status there. Taken out, it goes back to To Do. Once the batch has finished that process
//   nothing joins it unless the whole batch is sent back.
// - After that an instance leaves by being sent back: it returns to the File Producer process to
//   be made again, and the batch keeps a record that it was in it (`stagingBatchRemovals`).
// - A file is obsolete once any instance it was made for is. It can't go on another batch.

export type BatchRow = typeof stagingBatches.$inferSelect;
type FileRow = typeof files.$inferSelect;

/** An instance in a batch, or one that was sent back out of it (`removedAt`). */
export type BatchInstance = {
  partInstanceId: number;
  partDefinitionId: number;
  instanceNumber: number;
  removedAt: number | null;
  removedBy: string | null;
};

export type StoredFile = Omit<FileRow, "r2Key" | "obsoletedAt"> & {
  /** Made for an instance that is now obsolete: it can't go on another batch. */
  obsolete: boolean;
};

export type Batch = BatchRow & {
  /** Its name: the one it was given, else one from what's in it (`batchLabel`). */
  label: string;
  file: StoredFile | null;
  instances: BatchInstance[];
};

/** How many of one part a copy of a batch needs, and how many are free to go in it. */
export type DuplicatePart = {
  partDefinitionId: number;
  name: string | null;
  partNumber: string;
  revision: string | null;
  needed: number;
  available: number;
  /** The instances a copy would take. */
  partInstanceIds: number[];
  instanceNumbers: number[];
};

export type DuplicatePlan = {
  ok: boolean;
  /** Why it can't be copied, when it isn't for want of parts. */
  reason: string | null;
  parts: DuplicatePart[];
};

/** A request that can't be done as asked, with the sentence to show. */
export class BatchError extends Error {
  constructor(
    readonly status: 403 | 404 | 409,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// D1 caps a statement at 100 bound parameters.
const CHUNK = 80;
/** Rows of the widest insert here (6 columns) that fit under the cap. */
const INSERT_CHUNK = 15;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type NamedMember = { partDefinitionId: number; name: string | null; partNumber: string };

/**
 * A batch's name when nobody has given it one: its part and how many, when it holds one part, else
 * "Batch" and its number.
 */
export function batchLabel(row: Pick<BatchRow, "name" | "number">, members: NamedMember[]) {
  if (row.name) return row.name;
  const [first] = members;
  if (first && members.every((m) => m.partDefinitionId === first.partDefinitionId)) {
    return `${first.name || first.partNumber} × ${members.length}`;
  }
  return `Batch ${row.number}`;
}

export const storedFile = (
  { r2Key: _r2Key, obsoletedAt, ...file }: FileRow,
  obsolete: Set<number>,
): StoredFile => ({ ...file, obsolete: obsoletedAt !== null || obsolete.has(file.id) });

/**
 * The files that were made for an instance that's now obsolete (its own, or its whole revision),
 * whether it is still in the file's batch or was sent back out of it.
 */
export async function obsoleteFileIds(db: ShopDb, teamId: string, fileId?: number) {
  const gone = or(eq(partInstances.isStale, 1), eq(partDefinitions.isObsolete, 1));
  const ofFile =
    fileId === undefined ? isNotNull(stagingBatches.fileId) : eq(stagingBatches.fileId, fileId);
  const [inBatch, sentBack] = await Promise.all([
    db
      .selectDistinct({ fileId: stagingBatches.fileId })
      .from(partInstanceProcesses)
      .innerJoin(stagingBatches, eq(stagingBatches.id, partInstanceProcesses.batchId))
      .innerJoin(partInstances, eq(partInstances.id, partInstanceProcesses.partInstanceId))
      .innerJoin(partDefinitions, eq(partDefinitions.id, partInstances.partDefinitionId))
      .where(inTeam(stagingBatches, teamId, ofFile, gone))
      .all(),
    db
      .selectDistinct({ fileId: stagingBatches.fileId })
      .from(stagingBatchRemovals)
      .innerJoin(stagingBatches, eq(stagingBatches.id, stagingBatchRemovals.batchId))
      .innerJoin(partInstances, eq(partInstances.id, stagingBatchRemovals.partInstanceId))
      .innerJoin(partDefinitions, eq(partDefinitions.id, partInstances.partDefinitionId))
      .where(inTeam(stagingBatches, teamId, ofFile, gone))
      .all(),
  ]);
  return new Set([...inBatch, ...sentBack].flatMap((r) => r.fileId ?? []));
}

/** The team's file, if it is one, with whether it's obsolete. */
export async function teamFile(db: ShopDb, teamId: string, id: number) {
  const row = await db
    .select()
    .from(files)
    .where(inTeam(files, teamId, eq(files.id, id)))
    .get();
  return row ? storedFile(row, await obsoleteFileIds(db, teamId, id)) : null;
}

/** The team's batches (those `where` picks), oldest first, each with its file and instances. */
export async function loadBatches(db: ShopDb, teamId: string, where?: SQL): Promise<Batch[]> {
  const rows = await db
    .select()
    .from(stagingBatches)
    .where(inTeam(stagingBatches, teamId, where))
    .orderBy(asc(stagingBatches.id))
    .all();
  if (rows.length === 0) return [];

  const member = {
    batchId: stagingBatches.id,
    partInstanceId: partInstances.id,
    partDefinitionId: partInstances.partDefinitionId,
    instanceNumber: partInstances.instanceNumber,
    name: partDefinitions.name,
    partNumber: partDefinitions.onshapePartNumber,
  };
  const [members, removed, fileRows, obsolete] = await Promise.all([
    db
      .select(member)
      .from(partInstanceProcesses)
      .innerJoin(stagingBatches, eq(stagingBatches.id, partInstanceProcesses.batchId))
      .innerJoin(partInstances, eq(partInstances.id, partInstanceProcesses.partInstanceId))
      .innerJoin(partDefinitions, eq(partDefinitions.id, partInstances.partDefinitionId))
      .where(inTeam(stagingBatches, teamId, where))
      .orderBy(asc(partInstances.partDefinitionId), asc(partInstances.instanceNumber))
      .all(),
    db
      .select({
        ...member,
        removedAt: stagingBatchRemovals.removedAt,
        removedBy: stagingBatchRemovals.removedBy,
      })
      .from(stagingBatchRemovals)
      .innerJoin(stagingBatches, eq(stagingBatches.id, stagingBatchRemovals.batchId))
      .innerJoin(partInstances, eq(partInstances.id, stagingBatchRemovals.partInstanceId))
      .innerJoin(partDefinitions, eq(partDefinitions.id, partInstances.partDefinitionId))
      .where(inTeam(stagingBatches, teamId, where))
      .orderBy(asc(partInstances.partDefinitionId), asc(partInstances.instanceNumber))
      .all(),
    db
      .select()
      .from(files)
      .where(
        inTeam(
          files,
          teamId,
          inArray(
            files.id,
            db
              .select({ id: stagingBatches.fileId })
              .from(stagingBatches)
              .where(inTeam(stagingBatches, teamId, where)),
          ),
        ),
      )
      .all(),
    obsoleteFileIds(db, teamId),
  ]);

  const fileById = new Map(fileRows.map((f) => [f.id, storedFile(f, obsolete)]));
  return rows.map((row) => {
    const mine = members.filter((m) => m.batchId === row.id);
    const instances: BatchInstance[] = [
      ...mine.map((m) => ({
        partInstanceId: m.partInstanceId,
        partDefinitionId: m.partDefinitionId,
        instanceNumber: m.instanceNumber,
        removedAt: null,
        removedBy: null,
      })),
      ...removed
        .filter((r) => r.batchId === row.id)
        .map((r) => ({
          partInstanceId: r.partInstanceId,
          partDefinitionId: r.partDefinitionId,
          instanceNumber: r.instanceNumber,
          removedAt: r.removedAt,
          removedBy: r.removedBy,
        })),
    ];
    return {
      ...row,
      label: batchLabel(row, mine),
      file: row.fileId === null ? null : (fileById.get(row.fileId) ?? null),
      instances,
    };
  });
}

export async function loadBatch(db: ShopDb, teamId: string, id: number): Promise<Batch | null> {
  const [batch] = await loadBatches(db, teamId, eq(stagingBatches.id, id));
  return batch ?? null;
}

/** The team's batch as stored, or a 404. */
export async function batchRow(db: ShopDb, teamId: string, id: number): Promise<BatchRow> {
  const row = await db
    .select()
    .from(stagingBatches)
    .where(inTeam(stagingBatches, teamId, eq(stagingBatches.id, id)))
    .get();
  if (!row) throw new BatchError(404, "Batch not found.");
  return row;
}

async function processNames(db: ShopDb, teamId: string) {
  const rows = await db
    .select({ id: processes.id, name: processes.name })
    .from(processes)
    .where(inTeam(processes, teamId))
    .all();
  const names = new Map(rows.map((p) => [p.id, p.name]));
  return (id: number | null) => (id === null ? null : names.get(id)) ?? "its process";
}

type Step = {
  id: number;
  partInstanceId: number;
  processId: number;
  index: number;
  status: "waiting" | "todo" | "doing" | "done";
  batchId: number | null;
  type: ProcessType;
};

/** Each instance's steps, in order. */
async function pipelinesOf(db: ShopDb, teamId: string, instanceIds: number[]) {
  const out = new Map<number, Step[]>();
  for (const ids of chunks(instanceIds)) {
    const rows = await db
      .select({
        id: partInstanceProcesses.id,
        partInstanceId: partInstanceProcesses.partInstanceId,
        processId: partInstanceProcesses.processId,
        index: partInstanceProcesses.index,
        status: partInstanceProcesses.status,
        batchId: partInstanceProcesses.batchId,
        type: processes.type,
      })
      .from(partInstanceProcesses)
      .innerJoin(processes, eq(processes.id, partInstanceProcesses.processId))
      .where(
        inTeam(partInstanceProcesses, teamId, inArray(partInstanceProcesses.partInstanceId, ids)),
      )
      .orderBy(asc(partInstanceProcesses.index))
      .all();
    for (const row of rows) {
      const list = out.get(row.partInstanceId);
      if (list) list.push(row);
      else out.set(row.partInstanceId, [row]);
    }
  }
  return out;
}

type Member = {
  partInstanceId: number;
  partDefinitionId: number;
  instanceNumber: number;
  name: string | null;
  partNumber: string;
  revision: string | null;
  /** Not obsolete: neither it nor its revision. */
  live: boolean;
};

const memberColumns = {
  partInstanceId: partInstances.id,
  partDefinitionId: partInstances.partDefinitionId,
  instanceNumber: partInstances.instanceNumber,
  name: partDefinitions.name,
  partNumber: partDefinitions.onshapePartNumber,
  revision: partDefinitions.revision,
  isStale: partInstances.isStale,
  isObsolete: partDefinitions.isObsolete,
};

const asMember = ({
  isStale,
  isObsolete,
  ...m
}: Omit<Member, "live"> & { isStale: number; isObsolete: number }): Member => ({
  ...m,
  live: !isStale && !isObsolete,
});

/** The instances in a batch now. */
async function membersOf(db: ShopDb, teamId: string, batchId: number): Promise<Member[]> {
  const rows = await db
    .select(memberColumns)
    .from(partInstanceProcesses)
    .innerJoin(partInstances, eq(partInstances.id, partInstanceProcesses.partInstanceId))
    .innerJoin(partDefinitions, eq(partDefinitions.id, partInstances.partDefinitionId))
    .where(inTeam(partInstanceProcesses, teamId, eq(partInstanceProcesses.batchId, batchId)))
    .orderBy(asc(partInstances.partDefinitionId), asc(partInstances.instanceNumber))
    .all();
  return rows.map(asMember);
}

const partName = (m: Pick<Member, "name" | "partNumber" | "instanceNumber">) =>
  `${m.name || m.partNumber} #${m.instanceNumber}`;

async function logActions(
  db: ShopDb,
  teamId: string,
  userId: string,
  processId: number,
  instanceIds: number[],
  action: "started" | "completed",
) {
  const now = Date.now();
  try {
    for (const ids of chunks(instanceIds, INSERT_CHUNK)) {
      await db.insert(actions).values(
        withTeam(
          teamId,
          ids.map((partInstanceId) => ({
            userId,
            partInstanceId,
            processId,
            action,
            createdAt: now,
          })),
        ),
      );
    }
  } catch (err) {
    // Same policy as recordAction: the audit log never blocks shop-floor work.
    console.error("Failed to record actions:", err);
  }
}

/** A new, empty batch at a File Producer process, with the team's next number. */
export async function createBatch(
  db: ShopDb,
  teamId: string,
  values: { processId: number; fileId: number | null; name: string | null; createdBy: string },
): Promise<BatchRow> {
  for (let attempt = 0; ; attempt++) {
    const last = await db
      .select({ number: max(stagingBatches.number) })
      .from(stagingBatches)
      .where(inTeam(stagingBatches, teamId))
      .get();
    try {
      return await db
        .insert(stagingBatches)
        .values(
          withTeam(teamId, {
            ...values,
            number: (last?.number ?? 0) + 1,
            createdAt: Date.now(),
          }),
        )
        .returning()
        .get();
    } catch (err) {
      // Someone else took that number in the meantime: count again.
      if (attempt >= 4) throw err;
    }
  }
}

/**
 * Puts instances in a batch that hasn't finished its File Producer process. Each must be at that
 * process, in no batch, and headed for the same File Consumer process as the batch's others; it
 * takes on the batch's status there. Returns the ones that went in and why the others didn't.
 */
export async function stageInto(
  db: ShopDb,
  teamId: string,
  batch: BatchRow,
  instanceIds: number[],
  userId: string,
): Promise<{ staged: number[]; refused: string[] }> {
  const nameOf = await processNames(db, teamId);
  const here = nameOf(batch.processId);
  if (batch.producerStatus === "done") {
    throw new BatchError(
      409,
      `This batch has finished ${here}. Send the whole batch back to stage more instances into it.`,
    );
  }

  const info = new Map<number, Member>();
  for (const ids of chunks(instanceIds)) {
    const rows = await db
      .select(memberColumns)
      .from(partInstances)
      .innerJoin(partDefinitions, eq(partDefinitions.id, partInstances.partDefinitionId))
      .where(inTeam(partInstances, teamId, inArray(partInstances.id, ids)))
      .all();
    for (const row of rows) info.set(row.partInstanceId, asMember(row));
  }
  const pipelines = await pipelinesOf(db, teamId, [...info.keys()]);
  // An empty batch isn't for any File Consumer process yet: its first part decides.
  const hasMembers = (await membersOf(db, teamId, batch.id)).length > 0;
  let consumer = hasMembers ? batch.consumerProcessId : null;

  const refused: string[] = [];
  const accepted: number[] = [];
  const notStarted = new Set<number>();
  for (const id of instanceIds) {
    const part = info.get(id);
    // Not this team's: as if it hadn't been asked for.
    if (!part) continue;
    const steps = pipelines.get(id) ?? [];
    const step = steps.find((s) => s.processId === batch.processId);
    if (step?.batchId === batch.id) continue;
    const label = partName(part);
    if (!part.live) refused.push(`${label} is obsolete.`);
    else if (!step) refused.push(`${label} doesn't go through ${here}.`);
    else if (step.batchId !== null) refused.push(`${label} is already in another batch.`);
    else if (step.status === "waiting") refused.push(`${label} hasn't reached ${here} yet.`);
    else if (step.status === "done") {
      refused.push(`${label} has finished ${here}. Send it back there to stage it.`);
    } else {
      const next = steps.find((s) => s.index > step.index && s.type === "file_consumer");
      if (!next) {
        refused.push(`${label} has no File Consumer process after ${here}.`);
      } else if (consumer !== null && next.processId !== consumer) {
        refused.push(
          `${label} goes to ${nameOf(next.processId)} next, and this batch is for ${nameOf(consumer)}.`,
        );
      } else {
        consumer = next.processId;
        accepted.push(id);
        if (step.status === "todo") notStarted.add(id);
      }
    }
  }
  if (accepted.length === 0) return { staged: [], refused };

  if (consumer !== batch.consumerProcessId) {
    await db
      .update(stagingBatches)
      .set({ consumerProcessId: consumer })
      .where(inTeam(stagingBatches, teamId, eq(stagingBatches.id, batch.id)));
  }
  // Only while the batch is still as it was read: it may have been completed in the meantime.
  const unchanged = exists(
    db
      .select({ id: stagingBatches.id })
      .from(stagingBatches)
      .where(
        inTeam(
          stagingBatches,
          teamId,
          eq(stagingBatches.id, batch.id),
          eq(stagingBatches.producerStatus, batch.producerStatus),
        ),
      ),
  );
  const staged: number[] = [];
  for (const ids of chunks(accepted)) {
    const rows = await db
      .update(partInstanceProcesses)
      .set({ status: batch.producerStatus, batchId: batch.id })
      .where(
        inTeam(
          partInstanceProcesses,
          teamId,
          eq(partInstanceProcesses.processId, batch.processId),
          inArray(partInstanceProcesses.partInstanceId, ids),
          isNull(partInstanceProcesses.batchId),
          inArray(partInstanceProcesses.status, ["todo", "doing"]),
          unchanged,
        ),
      )
      .returning({ id: partInstanceProcesses.partInstanceId })
      .all();
    staged.push(...rows.map((r) => r.id));
  }
  if (batch.producerStatus === "doing") {
    const started = staged.filter((id) => notStarted.has(id));
    await logActions(db, teamId, userId, batch.processId, started, "started");
  }
  return { staged, refused };
}

/**
 * Takes instances out of a batch that hasn't finished its File Producer process: they go back to
 * To Do there. Returns the ones that came out.
 */
export async function unstageFrom(
  db: ShopDb,
  teamId: string,
  batch: BatchRow,
  instanceIds: number[],
): Promise<number[]> {
  if (batch.producerStatus === "done") {
    const here = (await processNames(db, teamId))(batch.processId);
    throw new BatchError(
      409,
      `This batch has finished ${here}. Send an instance back from the batch to take it out.`,
    );
  }
  const out: number[] = [];
  for (const ids of chunks(instanceIds)) {
    const rows = await db
      .update(partInstanceProcesses)
      .set({ status: "todo", batchId: null })
      .where(
        inTeam(
          partInstanceProcesses,
          teamId,
          eq(partInstanceProcesses.batchId, batch.id),
          inArray(partInstanceProcesses.partInstanceId, ids),
        ),
      )
      .returning({ id: partInstanceProcesses.partInstanceId })
      .all();
    out.push(...rows.map((r) => r.id));
  }
  return out;
}

/** Starts or completes a batch at its File Producer process, and its instances' steps with it. */
export async function moveAtProducer(
  db: ShopDb,
  teamId: string,
  batch: BatchRow,
  to: "doing" | "done",
  userId: string,
) {
  const from = to === "doing" ? (["todo"] as const) : (["todo", "doing"] as const);
  if (!(from as readonly string[]).includes(batch.producerStatus)) {
    throw new BatchError(
      409,
      to === "doing" ? "This batch has already been started." : "This batch is already complete.",
    );
  }
  if ((await membersOf(db, teamId, batch.id)).length === 0) {
    throw new BatchError(409, "Nothing is in this batch yet. Stage instances into it first.");
  }

  const now = Date.now();
  const moved = await db
    .update(stagingBatches)
    .set(
      to === "doing"
        ? { producerStatus: "doing" }
        : { producerStatus: "done", closedAt: now, consumerStatus: "todo", completedAt: null },
    )
    .where(
      inTeam(
        stagingBatches,
        teamId,
        eq(stagingBatches.id, batch.id),
        inArray(stagingBatches.producerStatus, [...from]),
      ),
    )
    .returning({ id: stagingBatches.id })
    .get();
  if (!moved) throw new BatchError(409, "Someone else just changed this batch. Check it again.");

  const steps = await db
    .update(partInstanceProcesses)
    .set(to === "doing" ? { status: "doing" } : { status: "done", completedAt: now })
    .where(
      inTeam(
        partInstanceProcesses,
        teamId,
        eq(partInstanceProcesses.batchId, batch.id),
        inArray(partInstanceProcesses.status, [...from]),
      ),
    )
    .returning({ id: partInstanceProcesses.partInstanceId })
    .all();
  if (to === "done") {
    // Each instance's next step becomes ready, as when one part is completed.
    await promoteNextSteps(
      db,
      teamId,
      and(eq(finished.batchId, batch.id), eq(finished.completedAt, now)),
    );
  }
  await logActions(
    db,
    teamId,
    userId,
    batch.processId,
    steps.map((s) => s.id),
    to === "doing" ? "started" : "completed",
  );
}

type AtConsumer = {
  member: Member;
  /** The batch's own step, at its File Producer process. */
  made: Step;
  /** The step that uses the file, when the instance has one. */
  uses: Step | null;
  /** The steps after the one that makes the file. */
  later: Step[];
  /** At the File Consumer process now: every step before it is done, and it isn't. */
  arrived: boolean;
};

/** Where each instance in a batch is on the way to the batch's File Consumer process. */
async function consumerSteps(db: ShopDb, teamId: string, batch: BatchRow): Promise<AtConsumer[]> {
  const members = await membersOf(db, teamId, batch.id);
  const pipelines = await pipelinesOf(
    db,
    teamId,
    members.map((m) => m.partInstanceId),
  );
  return members.flatMap((member) => {
    const steps = pipelines.get(member.partInstanceId) ?? [];
    const made = steps.find((s) => s.batchId === batch.id);
    if (!made) return [];
    const later = steps.filter((s) => s.index > made.index);
    const uses = later.find((s) => s.processId === batch.consumerProcessId) ?? null;
    const current = steps.find((s) => s.status !== "done");
    return { member, made, uses, later, arrived: !!uses && current?.id === uses.id };
  });
}

/** Starts or completes a batch at its File Consumer process, and its instances' steps with it. */
export async function moveAtConsumer(
  db: ShopDb,
  teamId: string,
  batch: BatchRow,
  to: "doing" | "done",
  userId: string,
) {
  const nameOf = await processNames(db, teamId);
  if (batch.producerStatus !== "done" || batch.consumerProcessId === null) {
    throw new BatchError(409, `This batch hasn't finished ${nameOf(batch.processId)} yet.`);
  }
  const there = nameOf(batch.consumerProcessId);
  const from = to === "doing" ? (["todo"] as const) : (["todo", "doing"] as const);
  if (!(from as readonly string[]).includes(batch.consumerStatus)) {
    throw new BatchError(
      409,
      to === "doing" ? "This batch has already been started." : "This batch is already complete.",
    );
  }

  // Obsolete parts stay where they are; they don't hold the others up.
  const live = (await consumerSteps(db, teamId, batch)).filter((s) => s.member.live);
  if (live.length === 0) throw new BatchError(409, "Nothing is left in this batch.");
  const missing = live.filter((s) => !s.arrived);
  if (missing.length > 0) {
    throw new BatchError(
      409,
      `${missing.length} of this batch's ${live.length} instances ${missing.length === 1 ? "hasn't" : "haven't"} reached ${there} yet: ${missing
        .slice(0, 5)
        .map((s) => partName(s.member))
        .join(", ")}${missing.length > 5 ? "…" : ""}.`,
    );
  }

  const now = Date.now();
  const moved = await db
    .update(stagingBatches)
    .set(
      to === "doing" ? { consumerStatus: "doing" } : { consumerStatus: "done", completedAt: now },
    )
    .where(
      inTeam(
        stagingBatches,
        teamId,
        eq(stagingBatches.id, batch.id),
        eq(stagingBatches.producerStatus, "done"),
        inArray(stagingBatches.consumerStatus, [...from]),
      ),
    )
    .returning({ id: stagingBatches.id })
    .get();
  if (!moved) throw new BatchError(409, "Someone else just changed this batch. Check it again.");

  const stepIds = live.flatMap((s) => s.uses?.id ?? []);
  const done: number[] = [];
  for (const ids of chunks(stepIds)) {
    const rows = await db
      .update(partInstanceProcesses)
      .set(to === "doing" ? { status: "doing" } : { status: "done", completedAt: now })
      .where(
        inTeam(
          partInstanceProcesses,
          teamId,
          inArray(partInstanceProcesses.id, ids),
          inArray(partInstanceProcesses.status, [...from]),
        ),
      )
      .returning({ id: partInstanceProcesses.partInstanceId })
      .all();
    done.push(...rows.map((r) => r.id));
    if (to === "done") {
      await promoteNextSteps(
        db,
        teamId,
        and(eq(finished.completedAt, now), inArray(finished.id, ids)),
      );
    }
  }
  await logActions(
    db,
    teamId,
    userId,
    batch.consumerProcessId,
    done,
    to === "doing" ? "started" : "completed",
  );
}

/** Steps back to To Do, and the ones after them back to waiting for those. */
async function rewind(
  db: ShopDb,
  teamId: string,
  toTodo: number[],
  toWaiting: number[],
  leaveBatch = false,
) {
  for (const ids of chunks(toTodo)) {
    await db
      .update(partInstanceProcesses)
      .set({ status: "todo", completedAt: null, ...(leaveBatch && { batchId: null }) })
      .where(inTeam(partInstanceProcesses, teamId, inArray(partInstanceProcesses.id, ids)));
  }
  for (const ids of chunks(toWaiting)) {
    await db
      .update(partInstanceProcesses)
      .set({ status: "waiting", completedAt: null, batchId: null })
      .where(inTeam(partInstanceProcesses, teamId, inArray(partInstanceProcesses.id, ids)));
  }
}

/**
 * Sends a whole batch back to To Do at its File Consumer process, or all the way to its File
 * Producer process, where parts can be added to it again. Every instance in it goes back with it.
 */
export async function sendBatchBack(
  db: ShopDb,
  teamId: string,
  batch: BatchRow,
  to: "producer" | "consumer",
) {
  const steps = await consumerSteps(db, teamId, batch);
  if (to === "consumer") {
    if (batch.producerStatus !== "done" || batch.consumerStatus === "todo") {
      throw new BatchError(409, "This batch hasn't been started there.");
    }
    await db
      .update(stagingBatches)
      .set({ consumerStatus: "todo", completedAt: null })
      .where(inTeam(stagingBatches, teamId, eq(stagingBatches.id, batch.id)));
    const used = steps.flatMap((s) => (s.uses ? [{ ...s, uses: s.uses }] : []));
    await rewind(
      db,
      teamId,
      used.map((s) => s.uses.id),
      used.flatMap((s) => s.later.filter((l) => l.index > s.uses.index).map((l) => l.id)),
    );
    return;
  }
  if (batch.producerStatus === "todo") {
    throw new BatchError(409, "This batch hasn't been started.");
  }
  await db
    .update(stagingBatches)
    .set({ producerStatus: "todo", consumerStatus: "todo", closedAt: null, completedAt: null })
    .where(inTeam(stagingBatches, teamId, eq(stagingBatches.id, batch.id)));
  await rewind(
    db,
    teamId,
    steps.map((s) => s.made.id),
    steps.flatMap((s) => s.later.map((l) => l.id)),
  );
}

/**
 * Sends one instance back out of a batch that has finished its File Producer process: it returns
 * to To Do there to be made again, and the batch keeps a record that it was in it.
 */
export async function sendInstanceBack(
  db: ShopDb,
  teamId: string,
  batch: BatchRow,
  partInstanceId: number,
  userId: string,
) {
  if (batch.producerStatus !== "done") {
    throw new BatchError(
      409,
      "This batch hasn't finished its File Producer process. Unstage the instance instead.",
    );
  }
  const step = (await consumerSteps(db, teamId, batch)).find(
    (s) => s.member.partInstanceId === partInstanceId,
  );
  if (!step) throw new BatchError(404, "That instance isn't in this batch.");
  await db.insert(stagingBatchRemovals).values(
    withTeam(teamId, {
      batchId: batch.id,
      partInstanceId,
      removedBy: userId,
      removedAt: Date.now(),
    }),
  );
  await rewind(
    db,
    teamId,
    [step.made.id],
    step.later.map((l) => l.id),
    true,
  );
}

/**
 * What a copy of a batch would take: as many of each part as the batch was made with (those sent
 * back since included, since its file makes them too), from the ones at its File Producer process
 * that are in no batch.
 */
export async function duplicatePlan(
  db: ShopDb,
  teamId: string,
  batch: BatchRow,
): Promise<DuplicatePlan> {
  const [members, removed] = await Promise.all([
    membersOf(db, teamId, batch.id),
    db
      .select(memberColumns)
      .from(stagingBatchRemovals)
      .innerJoin(partInstances, eq(partInstances.id, stagingBatchRemovals.partInstanceId))
      .innerJoin(partDefinitions, eq(partDefinitions.id, partInstances.partDefinitionId))
      .where(inTeam(stagingBatchRemovals, teamId, eq(stagingBatchRemovals.batchId, batch.id)))
      .all(),
  ]);
  const made = [...members, ...removed.map(asMember)];
  const byPart = new Map<number, Member[]>();
  for (const m of made)
    byPart.set(m.partDefinitionId, [...(byPart.get(m.partDefinitionId) ?? []), m]);

  const free =
    byPart.size === 0
      ? []
      : await db
          .select({
            partInstanceId: partInstances.id,
            partDefinitionId: partInstances.partDefinitionId,
            instanceNumber: partInstances.instanceNumber,
          })
          .from(partInstanceProcesses)
          .innerJoin(partInstances, eq(partInstances.id, partInstanceProcesses.partInstanceId))
          .innerJoin(partDefinitions, eq(partDefinitions.id, partInstances.partDefinitionId))
          .where(
            inTeam(
              partInstanceProcesses,
              teamId,
              eq(partInstanceProcesses.processId, batch.processId),
              isNull(partInstanceProcesses.batchId),
              inArray(partInstanceProcesses.status, ["todo", "doing"]),
              eq(partInstances.isStale, 0),
              eq(partDefinitions.isObsolete, 0),
            ),
          )
          .orderBy(desc(partInstances.isPriority), asc(partInstances.instanceNumber))
          .all();

  const parts = [...byPart.values()].map((list): DuplicatePart => {
    const [first] = list;
    const mine = free.filter((f) => f.partDefinitionId === first.partDefinitionId);
    const taken = mine.slice(0, list.length);
    return {
      partDefinitionId: first.partDefinitionId,
      name: first.name,
      partNumber: first.partNumber,
      revision: first.revision,
      needed: list.length,
      available: mine.length,
      partInstanceIds: taken.map((t) => t.partInstanceId),
      instanceNumbers: taken.map((t) => t.instanceNumber),
    };
  });

  const obsolete =
    batch.fileId !== null && (await obsoleteFileIds(db, teamId, batch.fileId)).has(batch.fileId);
  const reason =
    parts.length === 0
      ? "This batch has no instances to copy."
      : obsolete
        ? "This batch's file was made for a part that's now obsolete, so it can't go on another batch."
        : null;
  return { ok: reason === null && parts.every((p) => p.available >= p.needed), reason, parts };
}

/** Makes the copy `duplicatePlan` describes: a new batch with the same file, not started. */
export async function duplicateBatch(db: ShopDb, teamId: string, batch: BatchRow, userId: string) {
  const plan = await duplicatePlan(db, teamId, batch);
  if (!plan.ok) {
    throw new BatchError(409, plan.reason ?? "There aren't enough instances to copy this batch.", {
      plan,
    });
  }
  const copy = await createBatch(db, teamId, {
    processId: batch.processId,
    fileId: batch.fileId,
    name: batch.name ? `${batch.name} copy` : null,
    createdBy: userId,
  });
  const wanted = plan.parts.flatMap((p) => p.partInstanceIds);
  const { staged } = await stageInto(db, teamId, copy, wanted, userId);
  if (staged.length < wanted.length) {
    // Someone took one of those parts in the meantime: no half-made copy.
    await deleteBatch(db, teamId, copy);
    throw new BatchError(409, "Some of those instances were just staged elsewhere. Try again.", {
      plan: await duplicatePlan(db, teamId, batch),
    });
  }
  return copy;
}

/**
 * Deletes a batch that hasn't finished its File Producer process. What's in it goes back to To Do
 * there, and its file stays in the library.
 */
export async function deleteBatch(db: ShopDb, teamId: string, batch: BatchRow) {
  if (batch.producerStatus === "done") {
    const here = (await processNames(db, teamId))(batch.processId);
    throw new BatchError(409, `Send this batch back to ${here} before deleting it.`);
  }
  // All three only while it still hasn't: someone may have completed it in the meantime.
  const open = [eq(stagingBatches.id, batch.id), ne(stagingBatches.producerStatus, "done")];
  const stillOpen = exists(
    db
      .select({ id: stagingBatches.id })
      .from(stagingBatches)
      .where(inTeam(stagingBatches, teamId, ...open)),
  );
  await db.batch([
    db
      .update(partInstanceProcesses)
      .set({ status: "todo", batchId: null })
      .where(
        inTeam(
          partInstanceProcesses,
          teamId,
          eq(partInstanceProcesses.batchId, batch.id),
          stillOpen,
        ),
      ),
    db
      .delete(stagingBatchRemovals)
      .where(
        inTeam(stagingBatchRemovals, teamId, eq(stagingBatchRemovals.batchId, batch.id), stillOpen),
      ),
    db.delete(stagingBatches).where(inTeam(stagingBatches, teamId, ...open)),
  ]);
}

/**
 * The batch that moves this instance's step at this process, if one does: the instance is in it,
 * and the step is the batch's File Producer or File Consumer one.
 */
export async function governingBatch(
  db: ShopDb,
  teamId: string,
  partInstanceId: number,
  processId: number,
): Promise<BatchRow | null> {
  const row = await db
    .select({ batch: stagingBatches })
    .from(partInstanceProcesses)
    .innerJoin(stagingBatches, eq(stagingBatches.id, partInstanceProcesses.batchId))
    .where(
      inTeam(
        stagingBatches,
        teamId,
        eq(partInstanceProcesses.partInstanceId, partInstanceId),
        or(
          eq(stagingBatches.processId, processId),
          eq(stagingBatches.consumerProcessId, processId),
        ),
      ),
    )
    .get();
  return row?.batch ?? null;
}

/** Of these instances, the ones whose step at this process a batch moves. */
export async function governedInstances(
  db: ShopDb,
  teamId: string,
  partInstanceIds: number[],
  processId: number,
): Promise<Set<number>> {
  const out = new Set<number>();
  for (const ids of chunks(partInstanceIds)) {
    const rows = await db
      .select({ id: partInstanceProcesses.partInstanceId })
      .from(partInstanceProcesses)
      .innerJoin(stagingBatches, eq(stagingBatches.id, partInstanceProcesses.batchId))
      .where(
        inTeam(
          stagingBatches,
          teamId,
          inArray(partInstanceProcesses.partInstanceId, ids),
          or(
            eq(stagingBatches.processId, processId),
            eq(stagingBatches.consumerProcessId, processId),
          ),
        ),
      )
      .all();
    for (const row of rows) out.add(row.id);
  }
  return out;
}

/** What to say when a part's step can't be moved because its batch moves it. */
export async function governedMessage(db: ShopDb, teamId: string, batch: BatchRow) {
  const label = (await loadBatch(db, teamId, batch.id))?.label ?? `Batch ${batch.number}`;
  return `This part is in the batch "${label}", which moves as one. Open the batch to move it, or to send this instance back from it.`;
}
