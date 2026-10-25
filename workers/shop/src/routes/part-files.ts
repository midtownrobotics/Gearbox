import { inTeam, requireAuth, withTeam } from "@g3/auth";
import { desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { createShopDb } from "../db";
import { files, stagingBatches } from "../db/schema";
import { obsoleteFileIds, storedFile } from "../lib/batches";
import { partFileKey } from "../lib/storage";
import type { AppEnv } from "../types";

// The team's file library. A file reaches instances only through a batch (lib/batches.ts).

/** The most files one request deletes. */
const MAX_DELETE = 500;

/** The ids in `{ ids: [...] }`, or null when it isn't a list of 1 to MAX_DELETE ids. */
export function deleteIds(body: unknown): number[] | null {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_DELETE) return null;
  if (!ids.every((id) => Number.isInteger(id) && id > 0)) return null;
  return [...new Set(ids as number[])];
}

// Cloudflare rejects request bodies over 100 MB before they reach the worker anyway.
const MAX_FILE_BYTES = 100 * 1024 * 1024;

const denyKiosk = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("sessionType") === "pin") {
    return c.json({ error: "Kiosks can't change files." }, 403);
  }
  await next();
});

export const partFilesRouter = new Hono<AppEnv>()
  // Every file, newest first, with whether it's obsolete.
  .get("/", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const [rows, obsolete] = await Promise.all([
      db.select().from(files).where(inTeam(files, teamId)).orderBy(desc(files.createdAt)).all(),
      obsoleteFileIds(db, teamId),
    ]);
    return c.json(rows.map((row) => storedFile(row, obsolete)));
  })
  // Multipart upload into the library. It goes on a batch afterward.
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
      return c.json(storedFile(row, new Set()), 201);
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
  // Deletes several files at once (`{ ids }`), as one would each; ids not the team's are skipped.
  .post("/delete", requireAuth, denyKiosk, async (c) => {
    const ids = deleteIds(await c.req.json().catch(() => null));
    if (!ids) return c.json({ error: `Choose 1 to ${MAX_DELETE} files to delete.` }, 400);
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const rows = await db
      .select({ id: files.id, r2Key: files.r2Key })
      .from(files)
      .where(inTeam(files, teamId, inArray(files.id, ids)))
      .all();
    if (rows.length === 0) return c.json({ deleted: 0 });
    const found = rows.map((row) => row.id);
    await c.env.DRAWINGS.delete(rows.map((row) => row.r2Key));
    await db.batch([
      db
        .update(stagingBatches)
        .set({ fileId: null })
        .where(inTeam(stagingBatches, teamId, inArray(stagingBatches.fileId, found))),
      db.delete(files).where(inTeam(files, teamId, inArray(files.id, found))),
    ]);
    return c.json({ deleted: rows.length });
  })
  // Deletes the file from storage; a batch that had it has no file.
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
        .update(stagingBatches)
        .set({ fileId: null })
        .where(inTeam(stagingBatches, teamId, eq(stagingBatches.fileId, id))),
      db.delete(files).where(inTeam(files, teamId, eq(files.id, id))),
    ]);
    return c.json({ ok: true });
  });
