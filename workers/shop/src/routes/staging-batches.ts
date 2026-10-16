import { inTeam, requireAuth } from "@g3/auth";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createShopDb } from "../db";
import { processes, stagingBatches } from "../db/schema";
import {
  BatchError,
  batchRow,
  createBatch,
  deleteBatch,
  duplicateBatch,
  duplicatePlan,
  loadBatch,
  loadBatches,
  moveAtConsumer,
  moveAtProducer,
  sendBatchBack,
  sendInstanceBack,
  stageInto,
  teamFile,
  unstageFrom,
} from "../lib/batches";
import type { AppEnv } from "../types";

// Batches: instances that share one file, moved as one unit. The rules are in lib/batches.ts.

export type { Batch, BatchInstance, DuplicatePlan, StoredFile } from "../lib/batches";

const MAX_NAME = 80;

const isId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

function instanceIds(value: unknown): number[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 500 ||
    !value.every((n) => isId(n))
  ) {
    return null;
  }
  return [...new Set(value as number[])];
}

/** A name as typed: trimmed, and null (the automatic name) when it's left empty. */
function batchName(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim().length > MAX_NAME) return undefined;
  return value.trim() || null;
}

const instanceIdsValidator = validator("json", (value, c): { partInstanceIds: number[] } => {
  const ids = instanceIds(((value ?? {}) as { partInstanceIds?: unknown }).partInstanceIds);
  if (!ids) {
    return c.json({ error: "partInstanceIds must be 1–500 positive integers." }, 400) as never;
  }
  return { partInstanceIds: ids };
});

type NewBatch = {
  processId: number;
  name: string | null;
  fileId: number | null;
  partInstanceIds: number[];
};

const createValidator = validator("json", (value, c): NewBatch => {
  const v = (value ?? {}) as Record<string, unknown>;
  if (!isId(v.processId)) {
    return c.json({ error: "processId must be a positive integer." }, 400) as never;
  }
  const name = batchName(v.name);
  if (name === undefined) {
    return c.json({ error: `name must be ${MAX_NAME} characters or fewer.` }, 400) as never;
  }
  if (v.fileId !== undefined && v.fileId !== null && !isId(v.fileId)) {
    return c.json({ error: "fileId must be a positive integer." }, 400) as never;
  }
  const none = v.partInstanceIds === undefined || (v.partInstanceIds as unknown[]).length === 0;
  const ids = none ? [] : instanceIds(v.partInstanceIds);
  if (!ids) {
    return c.json({ error: "partInstanceIds must be 1–500 positive integers." }, 400) as never;
  }
  return {
    processId: v.processId,
    name,
    fileId: (v.fileId as number) ?? null,
    partInstanceIds: ids,
  };
});

const renameValidator = validator("json", (value, c): { name: string | null } => {
  const name = batchName(((value ?? {}) as { name?: unknown }).name);
  if (name === undefined) {
    return c.json({ error: `name must be ${MAX_NAME} characters or fewer.` }, 400) as never;
  }
  return { name };
});

const fileValidator = validator("json", (value, c): { fileId: number | null } => {
  const fileId = ((value ?? {}) as { fileId?: unknown }).fileId;
  if (fileId !== null && !isId(fileId)) {
    return c.json({ error: "fileId must be a positive integer or null." }, 400) as never;
  }
  return { fileId };
});

const statusValidator = validator(
  "json",
  (value, c): { at: "producer" | "consumer"; to: "doing" | "done" } => {
    const v = (value ?? {}) as { at?: unknown; to?: unknown };
    if (v.at !== "producer" && v.at !== "consumer") {
      return c.json({ error: "at must be 'producer' or 'consumer'." }, 400) as never;
    }
    if (v.to !== "doing" && v.to !== "done") {
      return c.json({ error: "to must be 'doing' or 'done'." }, 400) as never;
    }
    return { at: v.at, to: v.to };
  },
);

const sendBackValidator = validator("json", (value, c): { to: "producer" | "consumer" } => {
  const to = ((value ?? {}) as { to?: unknown }).to;
  if (to !== "producer" && to !== "consumer") {
    return c.json({ error: "to must be 'producer' or 'consumer'." }, 400) as never;
  }
  return { to };
});

const KIOSK_FILES = "Kiosks can't change a batch's file.";

export const stagingBatchesRouter = new Hono<AppEnv>()
  // What a rule in lib/batches.ts refuses, as the sentence to show (and, for a copy, the plan).
  .onError((err, c) => {
    if (err instanceof BatchError) {
      return c.json({ error: err.message, ...err.details }, err.status);
    }
    throw err;
  })
  // Every batch, oldest first, with its file and the instances in it or sent back out of it.
  .get("/", requireAuth, async (c) => {
    return c.json(await loadBatches(createShopDb(c.env.SHOP_DB), c.get("teamId")));
  })
  // A new batch at a File Producer process: empty, or with a file, or holding these instances
  // (linking a file to instances makes a batch of them).
  .post("/", requireAuth, createValidator, async (c) => {
    const { processId, name, fileId, partInstanceIds } = c.req.valid("json");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const process = await db
      .select({ type: processes.type })
      .from(processes)
      .where(inTeam(processes, teamId, eq(processes.id, processId)))
      .get();
    if (!process) return c.json({ error: "Process not found." }, 404);
    if (process.type !== "file_producer") {
      return c.json({ error: "A batch is made at a File Producer process." }, 409);
    }
    if (fileId !== null) {
      if (c.get("sessionType") === "pin") return c.json({ error: KIOSK_FILES }, 403);
      const file = await teamFile(db, teamId, fileId);
      if (!file) return c.json({ error: "File not found." }, 404);
      if (file.obsolete) {
        return c.json(
          { error: `${file.filename} was made for a part that's now obsolete. Upload a new file.` },
          409,
        );
      }
    }

    const userId = c.get("userId");
    const row = await createBatch(db, teamId, { processId, name, fileId, createdBy: userId });
    let refused: string[] = [];
    if (partInstanceIds.length > 0) {
      const result = await stageInto(db, teamId, row, partInstanceIds, userId);
      refused = result.refused;
      if (result.staged.length === 0) {
        // Nothing went in: no batch left behind.
        await deleteBatch(db, teamId, row);
        return c.json(
          { error: refused[0] ?? "None of those instances could be staged.", refused },
          409,
        );
      }
    }
    return c.json({ batch: await loadBatch(db, teamId, row.id), refused }, 201);
  })
  // Its name; null or empty for the automatic one.
  .patch("/:id", requireAuth, renameValidator, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await batchRow(db, teamId, Number(c.req.param("id")));
    await db
      .update(stagingBatches)
      .set({ name: c.req.valid("json").name })
      .where(inTeam(stagingBatches, teamId, eq(stagingBatches.id, batch.id)));
    return c.json(await loadBatch(db, teamId, batch.id));
  })
  // Adds instances that are at the batch's File Producer process; they take on its status there.
  .post("/:id/stage", requireAuth, instanceIdsValidator, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await batchRow(db, teamId, Number(c.req.param("id")));
    const { partInstanceIds } = c.req.valid("json");
    const { staged, refused } = await stageInto(
      db,
      teamId,
      batch,
      partInstanceIds,
      c.get("userId"),
    );
    if (staged.length === 0 && refused.length > 0) {
      return c.json({ error: refused[0], refused }, 409);
    }
    return c.json({ staged: staged.length, requested: partInstanceIds.length, refused });
  })
  // Takes instances out, back to To Do, while the batch is still at its File Producer process.
  .post("/:id/unstage", requireAuth, instanceIdsValidator, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await batchRow(db, teamId, Number(c.req.param("id")));
    const out = await unstageFrom(db, teamId, batch, c.req.valid("json").partInstanceIds);
    return c.json({ unstaged: out.length });
  })
  // Sets (or clears) the batch's file, until the batch is complete.
  .put("/:id/file", requireAuth, fileValidator, async (c) => {
    if (c.get("sessionType") === "pin") return c.json({ error: KIOSK_FILES }, 403);
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await batchRow(db, teamId, Number(c.req.param("id")));
    if (batch.producerStatus === "done" && batch.consumerStatus === "done") {
      return c.json({ error: "This batch is complete, so its file can't change." }, 409);
    }
    const { fileId } = c.req.valid("json");
    if (fileId !== null) {
      const file = await teamFile(db, teamId, fileId);
      if (!file) return c.json({ error: "File not found." }, 404);
      if (file.obsolete) {
        return c.json(
          { error: `${file.filename} was made for a part that's now obsolete. Upload a new file.` },
          409,
        );
      }
    }
    await db
      .update(stagingBatches)
      .set({ fileId })
      .where(inTeam(stagingBatches, teamId, eq(stagingBatches.id, batch.id)));
    return c.json({ ok: true });
  })
  // Starts or completes the batch, as one, at its File Producer or File Consumer process.
  .post("/:id/status", requireAuth, statusValidator, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await batchRow(db, teamId, Number(c.req.param("id")));
    const { at, to } = c.req.valid("json");
    const move = at === "producer" ? moveAtProducer : moveAtConsumer;
    await move(db, teamId, batch, to, c.get("userId"));
    return c.json({ ok: true });
  })
  // Sends the whole batch back to To Do at one of its two processes.
  .post("/:id/send-back", requireAuth, sendBackValidator, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await batchRow(db, teamId, Number(c.req.param("id")));
    await sendBatchBack(db, teamId, batch, c.req.valid("json").to);
    return c.json({ ok: true });
  })
  // Sends one instance back to the File Producer process; the batch keeps a record of it.
  .post("/:id/instances/:instanceId/send-back", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await batchRow(db, teamId, Number(c.req.param("id")));
    await sendInstanceBack(db, teamId, batch, Number(c.req.param("instanceId")), c.get("userId"));
    return c.json({ ok: true });
  })
  // What a copy of the batch would take, and whether there are enough free parts for it.
  .get("/:id/duplicate", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await batchRow(db, teamId, Number(c.req.param("id")));
    return c.json(await duplicatePlan(db, teamId, batch));
  })
  .post("/:id/duplicate", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await batchRow(db, teamId, Number(c.req.param("id")));
    const copy = await duplicateBatch(db, teamId, batch, c.get("userId"));
    return c.json({ batch: await loadBatch(db, teamId, copy.id) }, 201);
  })
  // Only while it's at its File Producer process; what's in it goes back to To Do.
  .delete("/:id", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const batch = await batchRow(db, teamId, Number(c.req.param("id")));
    await deleteBatch(db, teamId, batch);
    return c.json({ ok: true });
  });
