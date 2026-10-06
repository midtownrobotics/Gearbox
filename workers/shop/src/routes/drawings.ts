import { requireAuth } from "@g3/auth";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import * as schema from "../db/schema";
import type { AppEnv } from "../types";

export const drawingsRouter = new Hono<AppEnv>()
  // Deletes a released drawing (the same object /parts/:partNumber/:revision/drawing serves).
  .delete("/:partNumber/:revision", requireAuth, async (c) => {
    if (c.get("sessionType") === "pin") {
      return c.json({ error: "Kiosks can't delete drawings." }, 403);
    }
    const partNumber = c.req.param("partNumber");
    const revision = c.req.param("revision");
    const r2Key = `drawings/${partNumber}/${revision}/drawing.pdf`;

    const existing = await c.env.DRAWINGS.head(r2Key);
    if (!existing) return c.json({ error: "Drawing not found." }, 404);

    await c.env.DRAWINGS.delete(r2Key);
    const db = drizzle(c.env.SHOP_DB, { schema });
    await db.delete(schema.drawings).where(eq(schema.drawings.r2Key, r2Key));
    return c.json({ ok: true });
  })
  .get("/", async (c) => {
    try {
      const db = drizzle(c.env.SHOP_DB, { schema });
      const r2Objects = await c.env.DRAWINGS.list({ prefix: "drawings/" });

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
        const match = obj.key.match(/^drawings\/([^/]+)\/([^/]+)\/drawing\.pdf$/);
        if (!match) continue;

        const [, partNumber, revision] = match;
        const fileSize = obj.size || 0;
        totalSize += fileSize;
        partCounts.set(partNumber, (partCounts.get(partNumber) || 0) + 1);

        // Try to get metadata from DB if it exists
        const dbRecord = await db
          .select()
          .from(schema.drawings)
          .where(eq(schema.drawings.r2Key, obj.key))
          .get();

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

      // Use standard R2 key that matches OnShape export location
      const r2Key = `drawings/${partNumber}.pdf`;

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
      const db = drizzle(c.env.SHOP_DB, { schema });
      const now = Math.floor(Date.now() / 1000);

      const result = await db
        .insert(schema.drawings)
        .values({
          partNumber,
          filename: fileObj.name,
          r2Key,
          fileSize: fileObj.size,
          uploadedBy: uploadedBy || "unknown",
          createdAt: now,
        })
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
      const db = drizzle(c.env.SHOP_DB, { schema });

      const drawings = await db
        .select()
        .from(schema.drawings)
        .where(eq(schema.drawings.partNumber, partNumber))
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
      const db = drizzle(c.env.SHOP_DB, { schema });

      const drawing = await db
        .select()
        .from(schema.drawings)
        .where(eq(schema.drawings.id, drawingId))
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
