import { inTeam, requireAuth, withTeam } from "@g3/auth";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createShopDb } from "../db";
import * as schema from "../db/schema";
import { drawingKey, drawingsPrefix, uploadedDrawingKey } from "../lib/storage";
import type { AppEnv } from "../types";

/** Every object under a prefix (R2 lists 1,000 at a time). */
async function listAll(bucket: R2Bucket, prefix: string) {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

/** The team's drawings, signed in only. */
export const drawingsRouter = new Hono<AppEnv>()
  .use(requireAuth)
  // Deletes a released drawing (the same object /parts/:partNumber/:revision/drawing serves).
  .delete("/:partNumber/:revision", async (c) => {
    if (c.get("sessionType") === "pin") {
      return c.json({ error: "Kiosks can't delete drawings." }, 403);
    }
    const partNumber = c.req.param("partNumber");
    const revision = c.req.param("revision");
    const teamId = c.get("teamId");
    const r2Key = drawingKey(teamId, partNumber, revision);

    const existing = await c.env.DRAWINGS.head(r2Key);
    if (!existing) return c.json({ error: "Drawing not found." }, 404);

    await c.env.DRAWINGS.delete(r2Key);
    const db = createShopDb(c.env.SHOP_DB);
    await db
      .delete(schema.drawings)
      .where(inTeam(schema.drawings, teamId, eq(schema.drawings.r2Key, r2Key)));
    return c.json({ ok: true });
  })
  .get("/", async (c) => {
    try {
      const db = createShopDb(c.env.SHOP_DB);
      const teamId = c.get("teamId");
      const prefix = drawingsPrefix(teamId);
      const r2Objects = { objects: await listAll(c.env.DRAWINGS, prefix) };
      const records = new Map(
        (await db.select().from(schema.drawings).where(inTeam(schema.drawings, teamId)).all()).map(
          (d) => [d.r2Key, d],
        ),
      );

      const drawings: Array<{
        id: number;
        partNumber: string;
        revision: string;
        filename: string;
        r2Key: string;
        fileSize: number;
        uploadedBy: string | null;
        createdAt: number;
      }> = [];

      const partCounts = new Map<string, number>();
      let totalSize = 0;

      for (const obj of r2Objects.objects) {
        const match = obj.key.slice(prefix.length).match(/^([^/]+)\/([^/]+)\/drawing\.pdf$/);
        if (!match) continue;

        const [, partNumber, revision] = match;
        const fileSize = obj.size || 0;
        totalSize += fileSize;
        partCounts.set(partNumber, (partCounts.get(partNumber) || 0) + 1);

        // Metadata from the database, if it has a row for it
        const dbRecord = records.get(obj.key);

        drawings.push({
          id: dbRecord?.id || 0,
          partNumber,
          revision,
          filename: `${partNumber}_${revision}.pdf`,
          r2Key: obj.key,
          fileSize,
          uploadedBy: dbRecord?.uploadedBy || null,
          createdAt:
            dbRecord?.createdAt || Math.floor(obj.uploaded?.getTime() / 1000 || Date.now() / 1000),
        });
      }

      drawings.sort(
        (a, b) => a.partNumber.localeCompare(b.partNumber) || a.revision.localeCompare(b.revision),
      );

      return c.json({
        drawings,
        stats: {
          totalDrawings: drawings.length,
          totalSize,
          uniqueParts: partCounts.size,
        },
      });
    } catch (err) {
      console.error("[Drawing List Error]", err);
      return c.json({ error: err instanceof Error ? err.message : "Failed to list drawings" }, 500);
    }
  })
  .post("/upload", async (c) => {
    try {
      const formData = await c.req.formData();
      const file = formData.get("file") as unknown;
      const partNumber = formData.get("partNumber") as string;
      const uploadedBy = formData.get("uploadedBy") as string;

      if (!file || typeof file !== "object" || !("arrayBuffer" in file) || !partNumber) {
        return c.json({ error: "Missing file or partNumber" }, 400);
      }

      const fileObj = file as File;
      if (!fileObj.type.includes("pdf")) {
        return c.json({ error: "Only PDF files are supported" }, 400);
      }

      const teamId = c.get("teamId");
      const r2Key = uploadedDrawingKey(teamId, partNumber);

      // Upload to R2 (overwrites any existing drawing)
      const arrayBuffer = await fileObj.arrayBuffer();
      console.log("[Drawing Upload] Uploading to R2", { r2Key, size: arrayBuffer.byteLength });
      await c.env.DRAWINGS.put(r2Key, arrayBuffer, {
        httpMetadata: {
          contentType: "application/pdf",
        },
      });
      console.log("[Drawing Upload] Successfully uploaded to R2");

      // Store in database
      const db = createShopDb(c.env.SHOP_DB);
      const now = Math.floor(Date.now() / 1000);

      const result = await db
        .insert(schema.drawings)
        .values(
          withTeam(teamId, {
            partNumber,
            filename: fileObj.name,
            r2Key,
            fileSize: fileObj.size,
            uploadedBy: uploadedBy || c.get("userId"),
            createdAt: now,
          }),
        )
        .returning({ id: schema.drawings.id });

      const drawingId = result[0]?.id;
      if (!drawingId) {
        throw new Error("Failed to get drawing ID");
      }

      return c.json({
        success: true,
        id: drawingId,
        filename: fileObj.name,
        partNumber,
      });
    } catch (err) {
      console.error("[Drawing Upload Error]", err);
      return c.json({ error: err instanceof Error ? err.message : "Upload failed" }, 500);
    }
  })
  .get("/list/:partNumber", async (c) => {
    try {
      const partNumber = c.req.param("partNumber");
      const db = createShopDb(c.env.SHOP_DB);

      const drawings = await db
        .select()
        .from(schema.drawings)
        .where(inTeam(schema.drawings, c.get("teamId"), eq(schema.drawings.partNumber, partNumber)))
        .orderBy(schema.drawings.createdAt);

      return c.json({ drawings });
    } catch (err) {
      console.error("[Drawing List Error]", err);
      return c.json({ error: err instanceof Error ? err.message : "Failed to list drawings" }, 500);
    }
  })
  .get("/:drawingId/download", async (c) => {
    try {
      const drawingId = Number.parseInt(c.req.param("drawingId"), 10);
      const db = createShopDb(c.env.SHOP_DB);

      const drawing = await db
        .select()
        .from(schema.drawings)
        .where(inTeam(schema.drawings, c.get("teamId"), eq(schema.drawings.id, drawingId)))
        .get();

      if (!drawing) {
        return c.json({ error: "Drawing not found" }, 404);
      }

      // Fetch file from R2
      const file = await c.env.DRAWINGS.get(drawing.r2Key);
      if (!file) {
        return c.json({ error: "File not found in storage" }, 404);
      }

      // Stream the file with proper headers
      const arrayBuffer = await file.arrayBuffer();
      return c.newResponse(arrayBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${drawing.filename}"`,
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (err) {
      console.error("[Drawing Download Error]", err);
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to download drawing" },
        500,
      );
    }
  });
