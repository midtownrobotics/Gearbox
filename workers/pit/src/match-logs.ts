// SPDX-License-Identifier: AGPL-3.0-only
import {
  STORAGE_CLEANUP_RATIO,
  inTeam,
  isStorageFileExpired,
  notifyStorageCleanup,
  requireAdmin,
  requireAuth,
  requireMentor,
  withTeam,
  withTeamStorageLock,
} from "@g3/auth";
import { asc, desc, eq, inArray, lt } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type Db, createDb } from "./db";
import { logDownloaders, matchLogs } from "./db/schema";
import { requireDownloader } from "./downloaders";
import { getWhenFull } from "./settings";
import type { AppEnv } from "./types";
import { type ZipSource, writeZip, zipSize } from "./zip";

// Match logs: the AdvantageKit .wpilog files the team's paired log downloaders copy off the robot,
// gzipped, kept in the LOGS bucket (Shop's) under pit/teams/<team>/logs/, outside Shop's own
// teams/<team>/, which Shop deletes when a team switches it off. A log goes up in parts (R2
// multipart): Workers refuse a request body over 100 MB. A team keeps at most MAX_LOGS, each at
// most MAX_SIZE gzipped; the downloader trims a bigger one to part of the match first.

/** Each part but the last; R2 needs at least 5 MiB, and every part but the last the same size. */
export const PART_SIZE = 10 * 1024 * 1024;
/** The largest log taken, gzipped. */
export const MAX_SIZE = 40 * 1024 * 1024;
/** The most logs a team keeps. */
export const MAX_LOGS = 20;
export const MAX_PENDING_LOGS = 3;
export const UPLOAD_TTL = 30 * 60_000;

export const logsPrefix = (teamId: string) => `pit/teams/${teamId}/logs/`;
const logKey = (teamId: string, event: string, name: string) =>
  `${logsPrefix(teamId)}${event}/${name}.wpilog.gz`;

const EVENT = /^[A-Za-z0-9_-]{1,40}$/;
const NAME = /^(Qual|Elim|Prct)-\d{1,4}$/;
const TYPES = ["q", "e", "p"] as const;

function parseId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A stored log, as Pit's Logs page lists it. */
export type MatchLog = {
  id: number;
  event: string;
  name: string;
  matchType: "q" | "e" | "p";
  matchNumber: number;
  /** Bytes, gzipped. */
  size: number;
  /** The .wpilog's own bytes. */
  rawSize: number | null;
  trimmed: boolean;
  downloaderName: string;
  uploadedAt: number | null;
};

/** Deletes logs, their files first. */
async function deleteLogs(db: Db, bucket: R2Bucket, teamId: string, ids: number[]) {
  if (ids.length === 0) return 0;
  const removed = await db
    .select({ r2Key: matchLogs.r2Key, uploadId: matchLogs.uploadId })
    .from(matchLogs)
    .where(inTeam(matchLogs, teamId, inArray(matchLogs.id, ids)))
    .all();
  for (const log of removed) {
    if (log.uploadId) await bucket.resumeMultipartUpload(log.r2Key, log.uploadId).abort();
  }
  if (removed.length) await bucket.delete(removed.map((r) => r.r2Key));
  await db.delete(matchLogs).where(inTeam(matchLogs, teamId, inArray(matchLogs.id, ids)));
  return removed.length;
}

/** Pit's side (`/logs`): list, download, export, delete, and what to do when full. */
export const matchLogRoutes = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    const logs: MatchLog[] = await db
      .select({
        id: matchLogs.id,
        event: matchLogs.event,
        name: matchLogs.name,
        matchType: matchLogs.matchType,
        matchNumber: matchLogs.matchNumber,
        size: matchLogs.size,
        rawSize: matchLogs.rawSize,
        trimmed: matchLogs.trimmed,
        downloaderName: matchLogs.downloaderName,
        uploadedAt: matchLogs.uploadedAt,
      })
      .from(matchLogs)
      .where(inTeam(matchLogs, teamId, eq(matchLogs.status, "stored")))
      .orderBy(desc(matchLogs.uploadedAt));
    return c.json({
      logs,
      limit: MAX_LOGS,
      whenFull: await getWhenFull(db, teamId),
      canManage: c.get("userIsMentor") || c.get("userIsAdmin"),
      // Deleting logs is for admins only.
      canDelete: c.get("userIsAdmin"),
    });
  })

  // What Pit does with a new log once the team has MAX_LOGS.
  .put("/settings", requireMentor, async (c) => {
    const body = await c.req.json<{ whenFull?: string }>().catch(() => null);
    if (body?.whenFull !== "delete-expired")
      return c.json(
        { error: "Only logs older than six months can be removed automatically at capacity." },
        400,
      );
    return c.json({ whenFull: "delete-expired" });
  })

  // Every log as one zip of .wpilog files, built from the gzipped files as they are (zip.ts).
  .get("/export.zip", requireAuth, async (c) => {
    const logs = await createDb(c.env.PIT_DB)
      .select()
      .from(matchLogs)
      .where(inTeam(matchLogs, c.get("teamId"), eq(matchLogs.status, "stored")))
      .orderBy(asc(matchLogs.event), asc(matchLogs.name));
    const files: ZipSource[] = logs.map((log) => ({
      name: `${log.event}/${log.name}.wpilog`,
      key: log.r2Key,
      size: log.size,
      modified: new Date(log.uploadedAt ?? log.createdAt),
    }));
    const { readable, writable } = new TransformStream();
    c.executionCtx.waitUntil(
      writeZip(c.env.LOGS, files, writable).catch((err) => console.error("[pit] export", err)),
    );
    return new Response(readable, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(zipSize(files)),
        "Content-Disposition": 'attachment; filename="match-logs.zip"',
      },
    });
  })

  // The logs the page names (after an export: just those it exported).
  .delete("/", requireAdmin, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { ids?: unknown } | null;
    const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Number.isInteger) : [];
    if (ids.length === 0) return c.json({ error: "No logs named." }, 400);
    const deleted = await deleteLogs(
      createDb(c.env.PIT_DB),
      c.env.LOGS,
      c.get("teamId"),
      ids.slice(0, 1000),
    );
    return c.json({ deleted });
  })

  // One log as a .wpilog: stored gzipped, so the browser unzips it as it downloads.
  .get("/:id/file", requireAuth, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const log = await createDb(c.env.PIT_DB)
      .select()
      .from(matchLogs)
      .where(
        inTeam(matchLogs, c.get("teamId"), eq(matchLogs.status, "stored"), eq(matchLogs.id, id)),
      )
      .get();
    const object = log ? await c.env.LOGS.get(log.r2Key) : null;
    if (!log || !object) return c.json({ error: "Log not found." }, 404);
    return new Response(object.body, {
      encodeBody: "manual",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "gzip",
        "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename="${log.event}-${log.name}.wpilog"`,
      },
    });
  })

  .delete("/:id", requireAdmin, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const deleted = await deleteLogs(createDb(c.env.PIT_DB), c.env.LOGS, c.get("teamId"), [id]);
    if (!deleted) return c.json({ error: "Log not found." }, 404);
    return c.json({ ok: true });
  });

/** The downloader's side (`/downloader/logs`), with its key: start an upload, send parts, finish. */
export const logUploadRoutes = new Hono<AppEnv>()
  // The logs Pit has, so the downloader's page says which are in Gearbox (deleted here, they aren't).
  .get("/", requireDownloader, async (c) => {
    const logs = await createDb(c.env.PIT_DB)
      .select({ event: matchLogs.event, name: matchLogs.name })
      .from(matchLogs)
      .where(inTeam(matchLogs, c.get("teamId"), eq(matchLogs.status, "stored")));
    return c.json({ logs });
  })
  // Starts uploading a gzipped log, or says Pit already has it (the same event, name and size),
  // or that the team is full and keeps what it has (409, `full`).
  .post("/", requireDownloader, async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const event = String(body?.event ?? "");
    const name = String(body?.name ?? "");
    const matchType = body?.matchType as (typeof TYPES)[number];
    const matchNumber = Number(body?.matchNumber);
    const size = Number(body?.size);
    const rawSize = Number(body?.rawSize);
    const trimmed = body?.trimmed === true;
    if (
      !EVENT.test(event) ||
      !NAME.test(name) ||
      !TYPES.includes(matchType) ||
      !Number.isInteger(matchNumber) ||
      matchNumber < 0 ||
      !Number.isInteger(size) ||
      size < 1 ||
      !Number.isInteger(rawSize) ||
      rawSize < 1
    ) {
      return c.json({ error: "Not a match log Pit takes." }, 400);
    }
    if (size > MAX_SIZE) {
      return c.json(
        { error: "The log is over 40 MB compressed: trim it first.", code: "too_big" },
        413,
      );
    }

    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    return withTeamStorageLock(c.env.PIT_DB, teamId, async () => {
      const stale = await db
        .select()
        .from(matchLogs)
        .where(
          inTeam(
            matchLogs,
            teamId,
            eq(matchLogs.status, "uploading"),
            lt(matchLogs.createdAt, Date.now() - UPLOAD_TTL),
          ),
        );
      for (const log of stale) {
        if (log.uploadId) await c.env.LOGS.resumeMultipartUpload(log.r2Key, log.uploadId).abort();
        await db.delete(matchLogs).where(inTeam(matchLogs, teamId, eq(matchLogs.id, log.id)));
      }
      const existing = await db
        .select()
        .from(matchLogs)
        .where(inTeam(matchLogs, teamId, eq(matchLogs.event, event), eq(matchLogs.name, name)))
        .get();
      if (existing?.status === "stored" && existing.size === size) {
        return c.json({ id: existing.id, exists: true });
      }
      if (existing?.status === "stored") {
        return c.json(
          {
            error: "This log is already saved. Review and remove it before replacing it.",
            code: "already_saved",
          },
          409,
        );
      }

      const stored = await db
        .select({
          id: matchLogs.id,
          size: matchLogs.size,
          uploadedAt: matchLogs.uploadedAt,
          createdAt: matchLogs.createdAt,
        })
        .from(matchLogs)
        .where(inTeam(matchLogs, teamId, eq(matchLogs.status, "stored")));
      const expired = stored
        .filter((item) => isStorageFileExpired(item.uploadedAt ?? item.createdAt))
        .sort(
          (a, b) => (a.uploadedAt ?? a.createdAt) - (b.uploadedAt ?? b.createdAt) || a.id - b.id,
        );
      if (stored.length >= MAX_LOGS && expired.length < stored.length + 1 - MAX_LOGS)
        return c.json(
          {
            error:
              "Pit is full. Logs from the last six months are protected; review them before choosing what to remove.",
            code: "full",
          },
          409,
        );

      const pending = await db
        .select({ id: matchLogs.id })
        .from(matchLogs)
        .where(inTeam(matchLogs, teamId, eq(matchLogs.status, "uploading")));
      if (existing?.status !== "uploading" && pending.length >= MAX_PENDING_LOGS) {
        return c.json(
          {
            error: "Three logs are already uploading. Let them finish and try again.",
            code: "upload_busy",
          },
          409,
        );
      }
      // An upload of it that never finished: dropped, and started again.
      if (existing?.uploadId) {
        await c.env.LOGS.resumeMultipartUpload(existing.r2Key, existing.uploadId).abort();
      }

      const downloader = await db
        .select({ name: logDownloaders.name })
        .from(logDownloaders)
        .where(inTeam(logDownloaders, teamId, eq(logDownloaders.id, c.get("downloaderId"))))
        .get();
      const r2Key = logKey(teamId, event, name);
      const upload = await c.env.LOGS.createMultipartUpload(r2Key, {
        httpMetadata: { contentType: "application/gzip" },
      });
      const values = {
        matchType,
        matchNumber,
        size,
        rawSize,
        trimmed,
        r2Key,
        status: "uploading" as const,
        uploadId: upload.uploadId,
        downloaderId: c.get("downloaderId"),
        downloaderName: downloader?.name ?? "Log downloader",
        createdAt: Date.now(),
        uploadedAt: null,
      };
      let id = existing?.id;
      try {
        if (id) {
          await db
            .update(matchLogs)
            .set(values)
            .where(inTeam(matchLogs, teamId, eq(matchLogs.id, id)));
        } else {
          const [row] = await db
            .insert(matchLogs)
            .values(withTeam(teamId, { event, name, ...values }))
            .returning({ id: matchLogs.id });
          id = row.id;
        }
      } catch (error) {
        await upload.abort();
        throw error;
      }
      return c.json({ id, exists: false, partSize: PART_SIZE }, 201);
    });
  })

  // Deleting a log from Pit from the pit computer (its status page), by event and name. The paired
  // downloader is trusted with its team's logs; Pit's own pages leave deleting to admins.
  .delete("/:event/:name", requireDownloader, async (c) => {
    const event = c.req.param("event");
    const name = c.req.param("name");
    if (!EVENT.test(event) || !NAME.test(name)) return c.json({ error: "No such log." }, 400);
    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    const log = await db
      .select({ id: matchLogs.id })
      .from(matchLogs)
      .where(inTeam(matchLogs, teamId, eq(matchLogs.event, event), eq(matchLogs.name, name)))
      .get();
    // Already gone counts as done.
    if (log) await deleteLogs(db, c.env.LOGS, teamId, [log.id]);
    return c.json({ ok: true });
  })

  // One part: PART_SIZE bytes, or what's left for the last.
  .put(
    "/:id/parts/:part",
    requireDownloader,
    bodyLimit({
      maxSize: PART_SIZE,
      onError: (c) => c.json({ error: "A part is at most 10 MiB." }, 413),
    }),
    async (c) => {
      const id = parseId(c.req.param("id"));
      const part = parseId(c.req.param("part"));
      if (!id || !part || part > Math.ceil(MAX_SIZE / PART_SIZE))
        return c.json({ error: "Invalid part." }, 400);
      const log = await createDb(c.env.PIT_DB)
        .select()
        .from(matchLogs)
        .where(
          inTeam(
            matchLogs,
            c.get("teamId"),
            eq(matchLogs.id, id),
            eq(matchLogs.status, "uploading"),
          ),
        )
        .get();
      if (!log?.uploadId) return c.json({ error: "No upload of that log." }, 404);
      if (log.createdAt < Date.now() - UPLOAD_TTL)
        return c.json(
          { error: "This upload expired. Start the log again.", code: "upload_expired" },
          410,
        );
      const expected = Math.min(PART_SIZE, log.size - (part - 1) * PART_SIZE);
      if (expected <= 0) return c.json({ error: "Invalid part for this log." }, 400);
      const bytes = await c.req.arrayBuffer();
      if (bytes.byteLength !== expected) {
        return c.json({ error: "The part size does not match this log." }, 400);
      }
      const uploaded = await c.env.LOGS.resumeMultipartUpload(log.r2Key, log.uploadId).uploadPart(
        part,
        bytes,
      );
      return c.json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
    },
  )

  // The parts, in order: the log is stored. With the team deleting its oldest when full, the
  // oldest beyond MAX_LOGS go now.
  .post("/:id/complete", requireDownloader, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const body = (await c.req.json().catch(() => null)) as {
      parts?: { partNumber: number; etag: string }[];
    } | null;
    if (
      !Array.isArray(body?.parts) ||
      body.parts.length === 0 ||
      body.parts.length > Math.ceil(MAX_SIZE / PART_SIZE)
    ) {
      return c.json({ error: "No parts." }, 400);
    }
    const parts = body.parts;
    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    return withTeamStorageLock(c.env.PIT_DB, teamId, async () => {
      const log = await db
        .select()
        .from(matchLogs)
        .where(inTeam(matchLogs, teamId, eq(matchLogs.id, id), eq(matchLogs.status, "uploading")))
        .get();
      if (!log?.uploadId) return c.json({ error: "No upload of that log." }, 404);
      if (log.createdAt < Date.now() - UPLOAD_TTL)
        return c.json(
          { error: "This upload expired. Start the log again.", code: "upload_expired" },
          410,
        );
      if (
        parts.length !== Math.ceil(log.size / PART_SIZE) ||
        parts.some(
          (part, index) =>
            !part || part.partNumber !== index + 1 || typeof part.etag !== "string" || !part.etag,
        )
      ) {
        return c.json({ error: "Send every part once, in order." }, 400);
      }

      const stored = await db
        .select({
          id: matchLogs.id,
          size: matchLogs.size,
          uploadedAt: matchLogs.uploadedAt,
          createdAt: matchLogs.createdAt,
        })
        .from(matchLogs)
        .where(inTeam(matchLogs, teamId, eq(matchLogs.status, "stored")));
      const expired = stored
        .filter((item) => isStorageFileExpired(item.uploadedAt ?? item.createdAt))
        .sort(
          (a, b) => (a.uploadedAt ?? a.createdAt) - (b.uploadedAt ?? b.createdAt) || a.id - b.id,
        );
      if (stored.length >= MAX_LOGS && expired.length < stored.length + 1 - MAX_LOGS)
        return c.json(
          { error: "Pit is full. Logs from the last six months are protected.", code: "full" },
          409,
        );
      const object = await c.env.LOGS.resumeMultipartUpload(log.r2Key, log.uploadId)
        .complete(parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })))
        .catch(() => null);
      if (!object) return c.json({ error: "The parts didn't make the log." }, 400);
      if (object.size > MAX_SIZE || object.size !== log.size) {
        await c.env.LOGS.delete(log.r2Key);
        await db.delete(matchLogs).where(inTeam(matchLogs, teamId, eq(matchLogs.id, id)));
        return c.json(
          { error: "The log is over 40 MB compressed: trim it first.", code: "too_big" },
          413,
        );
      }
      await db
        .update(matchLogs)
        .set({ status: "stored", uploadId: null, size: object.size, uploadedAt: Date.now() })
        .where(inTeam(matchLogs, teamId, eq(matchLogs.id, id)));

      if (stored.length + 1 > MAX_LOGS) {
        const removed = expired.slice(
          0,
          stored.length + 1 - Math.floor(MAX_LOGS * STORAGE_CLEANUP_RATIO),
        );
        await deleteLogs(
          db,
          c.env.LOGS,
          teamId,
          removed.map((item) => item.id),
        );
        await notifyStorageCleanup(
          c.env,
          teamId,
          "pit",
          removed.map((item) => ({
            size: item.size,
            uploaded: new Date(item.uploadedAt ?? item.createdAt),
          })),
          c.env.PIT_DB,
        );
      }
      return c.json({ ok: true });
    });
  });

/** Deletes every log file of a team (with its data, when the team or Pit goes). */
export async function deleteTeamLogFiles(bucket: R2Bucket, teamId: string, db?: Db) {
  if (db) {
    const pending = await db
      .select()
      .from(matchLogs)
      .where(inTeam(matchLogs, teamId, eq(matchLogs.status, "uploading")));
    for (const log of pending) {
      if (log.uploadId) await bucket.resumeMultipartUpload(log.r2Key, log.uploadId).abort();
    }
  }
  for (;;) {
    const page = await bucket.list({ prefix: logsPrefix(teamId), limit: 1000 });
    if (page.objects.length === 0) return;
    await bucket.delete(page.objects.map((o) => o.key));
  }
}
