import { inTeam, requireAuth, withTeam } from "@g3/auth";
import { type SQLWrapper, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import { createShopDb } from "../db";
import { files, partDefinitions, partInstanceFiles, partInstances } from "../db/schema";
import { partFileKey } from "../lib/storage";
import type { AppEnv } from "../types";

// Cloudflare rejects request bodies over 100 MB before they reach the worker anyway.
const MAX_FILE_BYTES = 100 * 1024 * 1024;
// D1 caps a statement at 100 bound parameters; keep chunked writes under it.
const PARAM_CHUNK = 16;

type ShopDb = ReturnType<typeof createShopDb>;
type FileRow = typeof files.$inferSelect;
export type FileAssignment = {
  partInstanceId: number;
  partDefinitionId: number;
  instanceNumber: number;
};
export type PartFileWithAssignments = Omit<FileRow, "r2Key"> & { assignments: FileAssignment[] };

const denyKiosk = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("sessionType") === "pin") {
    return c.json({ error: "Kiosks can't change files." }, 403);
  }
  await next();
});

const setCountValidator = validator(
  "json",
  (value, c): { partDefinitionId: number; count: number } => {
    const v = (value ?? {}) as { partDefinitionId?: unknown; count?: unknown };
    if (!Number.isInteger(v.partDefinitionId) || (v.partDefinitionId as number) < 1) {
      return c.json({ error: "partDefinitionId must be a positive integer." }, 400) as never;
    }
    if (!Number.isInteger(v.count) || (v.count as number) < 0) {
      return c.json({ error: "count must be a non-negative integer." }, 400) as never;
    }
    return { partDefinitionId: v.partDefinitionId as number, count: v.count as number };
  },
);

function chunks<T>(items: T[], size = PARAM_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Attaches each file's instance assignments. `fileIds` may be a subquery to avoid param caps. */
async function withAssignments(
  db: ShopDb,
  teamId: string,
  rows: FileRow[],
  fileIds?: number[] | SQLWrapper,
): Promise<PartFileWithAssignments[]> {
  if (rows.length === 0) return [];
  const assigned = await db
    .select({
      fileId: partInstanceFiles.fileId,
      partInstanceId: partInstances.id,
      partDefinitionId: partInstances.partDefinitionId,
      instanceNumber: partInstances.instanceNumber,
    })
    .from(partInstanceFiles)
    .innerJoin(partInstances, eq(partInstances.id, partInstanceFiles.partInstanceId))
    .where(
      inTeam(
        partInstanceFiles,
        teamId,
        fileIds ? inArray(partInstanceFiles.fileId, fileIds) : undefined,
      ),
    )
    .orderBy(asc(partInstances.partDefinitionId), asc(partInstances.instanceNumber))
    .all();
  const byFile = new Map<number, FileAssignment[]>();
  for (const { fileId, ...a } of assigned) {
    const list = byFile.get(fileId) ?? [];
    list.push(a);
    byFile.set(fileId, list);
  }
  return rows.map(({ r2Key: _r2Key, ...f }) => ({ ...f, assignments: byFile.get(f.id) ?? [] }));
}

async function getFile(
  db: ShopDb,
  teamId: string,
  id: number,
): Promise<PartFileWithAssignments | null> {
  const row = await db
    .select()
    .from(files)
    .where(inTeam(files, teamId, eq(files.id, id)))
    .get();
  if (!row) return null;
  const [withA] = await withAssignments(db, teamId, [row], [id]);
  return withA;
}

/** This file's assignments on one part definition, lowest instance number first. */
function assignmentsOn(db: ShopDb, teamId: string, fileId: number, partDefinitionId: number) {
  return db
    .select({ id: partInstanceFiles.id, instanceNumber: partInstances.instanceNumber })
    .from(partInstanceFiles)
    .innerJoin(partInstances, eq(partInstances.id, partInstanceFiles.partInstanceId))
    .where(
      inTeam(
        partInstanceFiles,
        teamId,
        eq(partInstanceFiles.fileId, fileId),
        eq(partInstances.partDefinitionId, partDefinitionId),
      ),
    )
    .orderBy(asc(partInstances.instanceNumber))
    .all();
}

export const partFilesRouter = new Hono<AppEnv>()
  // All files, or only those assigned to some instance of ?partDefinitionId=.
  .get("/", requireAuth, async (c) => {
    const partDefinitionId = c.req.query("partDefinitionId");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");

    if (partDefinitionId === undefined) {
      const rows = await db
        .select()
        .from(files)
        .where(inTeam(files, teamId))
        .orderBy(desc(files.createdAt))
        .all();
      return c.json(await withAssignments(db, teamId, rows));
    }

    const fileIds = db
      .selectDistinct({ id: partInstanceFiles.fileId })
      .from(partInstanceFiles)
      .innerJoin(partInstances, eq(partInstances.id, partInstanceFiles.partInstanceId))
      .where(
        inTeam(partInstances, teamId, eq(partInstances.partDefinitionId, Number(partDefinitionId))),
      );
    const rows = await db
      .select()
      .from(files)
      .where(inTeam(files, teamId, inArray(files.id, fileIds)))
      .orderBy(desc(files.createdAt))
      .all();
    return c.json(await withAssignments(db, teamId, rows, fileIds));
  })
  // Multipart upload into the library. Assign instances afterward with PUT /:id/assignments.
  .post("/", requireAuth, denyKiosk, async (c) => {
    const form = await c.req.formData();
    // Workers' FormData typings omit File, but multipart file fields arrive as File objects.
    const file = form.get("file") as unknown as File | string | null;

    if (!file || typeof file === "string" || file.size === 0) {
      return c.json({ error: "A non-empty file is required." }, 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return c.json({ error: "Files must be 100 MB or smaller." }, 413);
    }

    const contentType = file.type || "application/octet-stream";
    const teamId = c.get("teamId");
    const r2Key = partFileKey(teamId, file.name);
    await c.env.DRAWINGS.put(r2Key, file.stream(), { httpMetadata: { contentType } });

    const db = createShopDb(c.env.SHOP_DB);
    try {
      const row = await db
        .insert(files)
        .values(
          withTeam(teamId, {
            filename: file.name,
            r2Key,
            contentType,
            fileSize: file.size,
            uploadedBy: c.get("userId"),
            createdAt: Date.now(),
          }),
        )
        .returning()
        .get();
      return c.json(await getFile(db, teamId, row.id), 201);
    } catch (err) {
      await c.env.DRAWINGS.delete(r2Key);
      throw err;
    }
  })
  .get("/:id/download", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const db = createShopDb(c.env.SHOP_DB);
    const row = await db
      .select()
      .from(files)
      .where(inTeam(files, c.get("teamId"), eq(files.id, id)))
      .get();
    if (!row) return c.json({ error: "File not found." }, 404);

    const object = await c.env.DRAWINGS.get(row.r2Key);
    if (!object) return c.json({ error: "File is missing from storage." }, 404);

    const asciiName = row.filename.replace(/[^\x20-\x7e]|"/g, "_");
    return new Response(object.body, {
      headers: {
        "Content-Type": row.contentType,
        "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  })
  /**
   * Sets how many instances of one part definition this file covers. Growing picks active
   * instances with no file yet, lowest number first, and may fall short; shrinking drops the
   * highest-numbered first. Returns the requested and actually-assigned counts.
   */
  .put("/:id/assignments", requireAuth, denyKiosk, setCountValidator, async (c) => {
    const id = Number(c.req.param("id"));
    const { partDefinitionId, count } = c.req.valid("json");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");

    const [file, definition] = await Promise.all([
      db
        .select({ id: files.id })
        .from(files)
        .where(inTeam(files, teamId, eq(files.id, id)))
        .get(),
      db
        .select({ id: partDefinitions.id })
        .from(partDefinitions)
        .where(inTeam(partDefinitions, teamId, eq(partDefinitions.id, partDefinitionId)))
        .get(),
    ]);
    if (!file) return c.json({ error: "File not found." }, 404);
    if (!definition) return c.json({ error: "Part not found." }, 404);

    const current = await assignmentsOn(db, teamId, id, partDefinitionId);

    if (count > current.length) {
      const free = await db
        .select({ id: partInstances.id })
        .from(partInstances)
        .leftJoin(partInstanceFiles, eq(partInstanceFiles.partInstanceId, partInstances.id))
        .where(
          inTeam(
            partInstances,
            teamId,
            eq(partInstances.partDefinitionId, partDefinitionId),
            eq(partInstances.isStale, 0),
            isNull(partInstanceFiles.id),
          ),
        )
        .orderBy(asc(partInstances.instanceNumber))
        .limit(count - current.length)
        .all();

      const userId = c.get("userId");
      const now = Date.now();
      for (const batch of chunks(free)) {
        // Ignore conflicts: a concurrent request may have taken an instance in the meantime.
        await db
          .insert(partInstanceFiles)
          .values(
            withTeam(
              teamId,
              batch.map((i) => ({
                fileId: id,
                partInstanceId: i.id,
                assignedBy: userId,
                createdAt: now,
              })),
            ),
          )
          .onConflictDoNothing();
      }
    } else if (count < current.length) {
      const drop = current.slice(count).map((a) => a.id);
      for (const batch of chunks(drop)) {
        await db
          .delete(partInstanceFiles)
          .where(inTeam(partInstanceFiles, teamId, inArray(partInstanceFiles.id, batch)));
      }
    }

    const assigned = (await assignmentsOn(db, teamId, id, partDefinitionId)).length;
    return c.json({ file: await getFile(db, teamId, id), requested: count, assigned });
  })
  .delete("/:id/assignments/:instanceId", requireAuth, denyKiosk, async (c) => {
    const id = Number(c.req.param("id"));
    const instanceId = Number(c.req.param("instanceId"));
    const db = createShopDb(c.env.SHOP_DB);
    await db
      .delete(partInstanceFiles)
      .where(
        inTeam(
          partInstanceFiles,
          c.get("teamId"),
          eq(partInstanceFiles.fileId, id),
          eq(partInstanceFiles.partInstanceId, instanceId),
        ),
      );
    return c.json({ ok: true });
  })
  // Deletes the file from storage and unassigns every instance it covered.
  .delete("/:id", requireAuth, denyKiosk, async (c) => {
    const id = Number(c.req.param("id"));
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const row = await db
      .select()
      .from(files)
      .where(inTeam(files, teamId, eq(files.id, id)))
      .get();
    if (!row) return c.json({ error: "File not found." }, 404);

    await c.env.DRAWINGS.delete(row.r2Key);
    await db.batch([
      db
        .delete(partInstanceFiles)
        .where(inTeam(partInstanceFiles, teamId, eq(partInstanceFiles.fileId, id))),
      db.delete(files).where(inTeam(files, teamId, eq(files.id, id))),
    ]);
    return c.json({ ok: true });
  });
