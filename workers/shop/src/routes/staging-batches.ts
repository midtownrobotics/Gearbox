import { inTeam, requireAuth, withTeam } from "@g3/auth";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createShopDb } from "../db";
import {
  actions,
  files,
  partInstanceFiles,
  partInstanceProcesses,
  processes,
  stagingBatches,
} from "../db/schema";
import { finished, promoteNextSteps } from "../lib/steps";
import type { AppEnv } from "../types";

type ShopDb = ReturnType<typeof createShopDb>;
type BatchRow = typeof stagingBatches.$inferSelect;

export type StagingBatch = Omit<BatchRow, "closedAt"> & { partInstanceIds: number[] };

// D1 caps a statement at 100 bound parameters; the widest insert here has 6 columns.
const CHUNK = 15;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const instanceIdsValidator = validator("json", (value, c): { partInstanceIds: number[] } => {
  const ids = ((value ?? {}) as { partInstanceIds?: unknown }).partInstanceIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 500 ||
    !ids.every((n) => Number.isInteger(n) && n > 0)
  ) {
    return c.json({ error: "partInstanceIds must be 1–500 positive integers." }, 400) as never;
  }
  return { partInstanceIds: [...new Set(ids as number[])] };
});

const createValidator = validator("json", (value, c): { processId: number } => {
  const processId = ((value ?? {}) as { processId?: unknown }).processId;
  if (!Number.isInteger(processId) || (processId as number) < 1) {
    return c.json({ error: "processId must be a positive integer." }, 400) as never;
  }
  return { processId: processId as number };
});

const fileValidator = validator("json", (value, c): { fileId: number | null } => {
  const fileId = ((value ?? {}) as { fileId?: unknown }).fileId;
  if (fileId !== null && (!Number.isInteger(fileId) || (fileId as number) < 1)) {
    return c.json({ error: "fileId must be a positive integer or null." }, 400) as never;
  }
  return { fileId: fileId as number | null };
});

async function getOpenBatch(db: ShopDb, teamId: string, id: number): Promise<BatchRow | null> {
  const row = await db
    .select()
    .from(stagingBatches)
    .where(
      inTeam(stagingBatches, teamId, eq(stagingBatches.id, id), isNull(stagingBatches.closedAt)),
    )
    .get();
  return row ?? null;
}

/** Instances currently staged in a batch (in progress at its process). */
async function stagedIn(db: ShopDb, batch: BatchRow): Promise<number[]> {
  const rows = await db
    .select({ id: partInstanceProcesses.partInstanceId })
    .from(partInstanceProcesses)
    .where(
      inTeam(
        partInstanceProcesses,
        batch.teamId,
        eq(partInstanceProcesses.batchId, batch.id),
        eq(partInstanceProcesses.processId, batch.processId),
        eq(partInstanceProcesses.status, "doing"),
      ),
    )
    .all();
  return rows.map((r) => r.id);
}

/** Makes `fileId` the only file on these instances (or clears them when null). */
async function putFileOn(
  db: ShopDb,
  teamId: string,
  fileId: number | null,
  instanceIds: number[],
  userId: string,
): Promise<void> {
  const now = Date.now();
  for (const batch of chunks(instanceIds)) {
    await db
      .delete(partInstanceFiles)
      .where(inTeam(partInstanceFiles, teamId, inArray(partInstanceFiles.partInstanceId, batch)));
    if (fileId !== null) {
      await db
        .insert(partInstanceFiles)
        .values(
          withTeam(
            teamId,
            batch.map((id) => ({ fileId, partInstanceId: id, assignedBy: userId, createdAt: now })),
          ),
        )
        .onConflictDoNothing();
    }
  }
}

async function logActions(
  db: ShopDb,
  teamId: string,
  userId: string,
  processId: number,
  instanceIds: number[],
  action: "started" | "completed",
): Promise<void> {
  const now = Date.now();
  try {
    for (const batch of chunks(instanceIds)) {
      await db.insert(actions).values(
        withTeam(
          teamId,
          batch.map((partInstanceId) => ({
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

export const stagingBatchesRouter = new Hono<AppEnv>()
  // Open batches for a process, oldest first, with the instances staged in each.
  .get("/", requireAuth, async (c) => {
    const processId = Number(c.req.query("processId"));
    if (!Number.isInteger(processId) || processId < 1) {
      return c.json({ error: "processId query param is required." }, 400);
    }
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batches = await db
      .select()
      .from(stagingBatches)
      .where(
        inTeam(
          stagingBatches,
          teamId,
          eq(stagingBatches.processId, processId),
          isNull(stagingBatches.closedAt),
        ),
      )
      .orderBy(asc(stagingBatches.createdAt))
      .all();
    if (batches.length === 0) return c.json([] as StagingBatch[]);

    const staged = await db
      .select({ batchId: partInstanceProcesses.batchId, id: partInstanceProcesses.partInstanceId })
      .from(partInstanceProcesses)
      .where(
        inTeam(
          partInstanceProcesses,
          teamId,
          eq(partInstanceProcesses.processId, processId),
          eq(partInstanceProcesses.status, "doing"),
          inArray(
            partInstanceProcesses.batchId,
            db
              .select({ id: stagingBatches.id })
              .from(stagingBatches)
              .where(
                inTeam(
                  stagingBatches,
                  teamId,
                  eq(stagingBatches.processId, processId),
                  isNull(stagingBatches.closedAt),
                ),
              ),
          ),
        ),
      )
      .all();

    return c.json(
      batches.map(({ closedAt: _closedAt, ...b }) => ({
        ...b,
        partInstanceIds: staged.filter((s) => s.batchId === b.id).map((s) => s.id),
      })) as StagingBatch[],
    );
  })
  .post("/", requireAuth, createValidator, async (c) => {
    const { processId } = c.req.valid("json");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const process = await db
      .select({ id: processes.id })
      .from(processes)
      .where(inTeam(processes, teamId, eq(processes.id, processId)))
      .get();
    if (!process) return c.json({ error: "Process not found." }, 404);
    const row = await db
      .insert(stagingBatches)
      .values(withTeam(teamId, { processId, createdBy: c.get("userId"), createdAt: Date.now() }))
      .returning()
      .get();
    return c.json(row, 201);
  })
  // Stages To Do instances (or in-progress ones outside any batch) into this batch; they take
  // the batch's file. A batch left empty because nothing could be staged is removed.
  .post("/:id/stage", requireAuth, instanceIdsValidator, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await getOpenBatch(db, teamId, Number(c.req.param("id")));
    if (!batch) return c.json({ error: "Batch not found or already completed." }, 404);
    const { partInstanceIds } = c.req.valid("json");

    const staged: number[] = [];
    for (const ids of chunks(partInstanceIds)) {
      const rows = await db
        .update(partInstanceProcesses)
        .set({ status: "doing", batchId: batch.id })
        .where(
          inTeam(
            partInstanceProcesses,
            teamId,
            eq(partInstanceProcesses.processId, batch.processId),
            inArray(partInstanceProcesses.partInstanceId, ids),
            sql`(${partInstanceProcesses.status} = 'todo' OR (${partInstanceProcesses.status} = 'doing' AND ${partInstanceProcesses.batchId} IS NULL))`,
          ),
        )
        .returning({ id: partInstanceProcesses.partInstanceId })
        .all();
      staged.push(...rows.map((r) => r.id));
    }

    if (staged.length === 0 && (await stagedIn(db, batch)).length === 0) {
      await db
        .delete(stagingBatches)
        .where(inTeam(stagingBatches, teamId, eq(stagingBatches.id, batch.id)));
      return c.json({ error: "None of those instances could be staged." }, 409);
    }

    const userId = c.get("userId");
    if (batch.fileId !== null) await putFileOn(db, teamId, batch.fileId, staged, userId);
    await logActions(db, teamId, userId, batch.processId, staged, "started");
    return c.json({ staged: staged.length, requested: partInstanceIds.length });
  })
  // Sends instances back to To Do and drops the batch's file from them.
  .post("/:id/unstage", requireAuth, instanceIdsValidator, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await getOpenBatch(db, teamId, Number(c.req.param("id")));
    if (!batch) return c.json({ error: "Batch not found or already completed." }, 404);
    const { partInstanceIds } = c.req.valid("json");

    const unstaged: number[] = [];
    for (const ids of chunks(partInstanceIds)) {
      const rows = await db
        .update(partInstanceProcesses)
        .set({ status: "todo", batchId: null })
        .where(
          inTeam(
            partInstanceProcesses,
            teamId,
            eq(partInstanceProcesses.batchId, batch.id),
            eq(partInstanceProcesses.status, "doing"),
            inArray(partInstanceProcesses.partInstanceId, ids),
          ),
        )
        .returning({ id: partInstanceProcesses.partInstanceId })
        .all();
      unstaged.push(...rows.map((r) => r.id));
    }
    await putFileOn(db, teamId, null, unstaged, c.get("userId"));

    // A batch that empties out is gone; batches only exist while they hold work.
    const deleted = (await stagedIn(db, batch)).length === 0;
    if (deleted) {
      await db
        .delete(stagingBatches)
        .where(inTeam(stagingBatches, teamId, eq(stagingBatches.id, batch.id)));
    }
    return c.json({ unstaged: unstaged.length, batchDeleted: deleted });
  })
  // Sets (or clears) the batch's file and applies it to every staged instance.
  .put("/:id/file", requireAuth, fileValidator, async (c) => {
    if (c.get("sessionType") === "pin") {
      return c.json({ error: "Kiosks can't change a batch's file." }, 403);
    }
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await getOpenBatch(db, teamId, Number(c.req.param("id")));
    if (!batch) return c.json({ error: "Batch not found or already completed." }, 404);
    const { fileId } = c.req.valid("json");

    if (fileId !== null) {
      const file = await db
        .select({ id: files.id })
        .from(files)
        .where(inTeam(files, teamId, eq(files.id, fileId)))
        .get();
      if (!file) return c.json({ error: "File not found." }, 404);
    }
    await db
      .update(stagingBatches)
      .set({ fileId })
      .where(inTeam(stagingBatches, teamId, eq(stagingBatches.id, batch.id)));
    await putFileOn(db, teamId, fileId, await stagedIn(db, batch), c.get("userId"));
    return c.json({ ok: true });
  })
  // Completes every staged instance (unlocking each one's next process) and closes the batch.
  .post("/:id/complete", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await getOpenBatch(db, teamId, Number(c.req.param("id")));
    if (!batch) return c.json({ error: "Batch not found or already completed." }, 404);
    if (batch.fileId === null) {
      return c.json({ error: "Add a file to the batch before completing it." }, 409);
    }

    const now = Date.now();
    const done = await db
      .update(partInstanceProcesses)
      .set({ status: "done", completedAt: now })
      .where(
        inTeam(
          partInstanceProcesses,
          teamId,
          eq(partInstanceProcesses.batchId, batch.id),
          eq(partInstanceProcesses.status, "doing"),
        ),
      )
      .returning({ id: partInstanceProcesses.partInstanceId })
      .all();
    if (done.length === 0) return c.json({ error: "Nothing is staged in this batch." }, 409);

    // Promote each instance's next step, mirroring the single-instance "done" route.
    await promoteNextSteps(
      db,
      teamId,
      and(eq(finished.batchId, batch.id), eq(finished.completedAt, now)),
    );

    await db
      .update(stagingBatches)
      .set({ closedAt: now })
      .where(inTeam(stagingBatches, teamId, eq(stagingBatches.id, batch.id)));
    await logActions(
      db,
      teamId,
      c.get("userId"),
      batch.processId,
      done.map((r) => r.id),
      "completed",
    );
    return c.json({ completed: done.length });
  })
  // Only empty batches can be deleted; unstage everything first.
  .delete("/:id", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await getOpenBatch(db, teamId, Number(c.req.param("id")));
    if (!batch) return c.json({ error: "Batch not found or already completed." }, 404);
    if ((await stagedIn(db, batch)).length > 0) {
      return c.json({ error: "Unstage everything in this batch before deleting it." }, 409);
    }
    await db
      .delete(stagingBatches)
      .where(inTeam(stagingBatches, teamId, eq(stagingBatches.id, batch.id)));
    return c.json({ ok: true });
  });
