import { inTeam, logTeamChange, requireAuth, requireMentor, withTeam } from "@g3/auth";
import { asc, desc, eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { type Db, createDb } from "./db";
import { logDownloaders, matchLogs, settings } from "./db/schema";
import { requireDownloader } from "./downloaders";
import { WHEN_FULL, type WhenFull, getWhenFull } from "./settings";
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
    .delete(matchLogs)
    .where(inTeam(matchLogs, teamId, inArray(matchLogs.id, ids)))
    .returning({ r2Key: matchLogs.r2Key });
  if (removed.length) await bucket.delete(removed.map((r) => r.r2Key));
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
    });
  })

  // What Pit does with a new log once the team has MAX_LOGS.
  .put("/settings", requireMentor, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { whenFull?: unknown } | null;
    const whenFull = body?.whenFull as WhenFull;
    if (!WHEN_FULL.includes(whenFull)) return c.json({ error: "Not a choice." }, 400);
    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    if ((await getWhenFull(db, teamId)) !== whenFull) {
      await db
        .insert(settings)
        .values(withTeam(teamId, { key: "matchLogsWhenFull", value: whenFull }))
        .onConflictDoUpdate({ target: [settings.teamId, settings.key], set: { value: whenFull } });
      await logTeamChange(c.env, teamId, {
        userId: c.get("userId"),
        app: "pit",
        what: "Match logs when full",
        changed: ["When Pit has 20 match logs"],
      });
    }
    return c.json({ whenFull });
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
  .delete("/", requireMentor, async (c) => {
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

  .delete("/:id", requireMentor, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const deleted = await deleteLogs(createDb(c.env.PIT_DB), c.env.LOGS, c.get("teamId"), [id]);
    if (!deleted) return c.json({ error: "Log not found." }, 404);
    return c.json({ ok: true });
  });

/** The downloader's side (`/downloader/logs`), with its key: start an upload, send parts, finish. */
export const logUploadRoutes = new Hono<AppEnv>()
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
    const existing = await db
      .select()
      .from(matchLogs)
      .where(inTeam(matchLogs, teamId, eq(matchLogs.event, event), eq(matchLogs.name, name)))
      .get();
    if (existing?.status === "stored" && existing.size === size) {
      return c.json({ id: existing.id, exists: true });
    }
    // A new log, with the team at its limit and keeping what it has.
    if (existing?.status !== "stored") {
      const others = await db
        .select({ id: matchLogs.id })
        .from(matchLogs)
        .where(inTeam(matchLogs, teamId, eq(matchLogs.status, "stored")));
      if (others.length >= MAX_LOGS && (await getWhenFull(db, teamId)) === "skip-new") {
        return c.json(
          { error: `Pit has ${MAX_LOGS} match logs, the most it keeps.`, code: "full" },
          409,
        );
      }
    }
    // An upload of it that never finished: dropped, and started again.
    if (existing?.uploadId) {
      await c.env.LOGS.resumeMultipartUpload(existing.r2Key, existing.uploadId)
        .abort()
        .catch(() => {});
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
    return c.json({ id, exists: false, partSize: PART_SIZE }, 201);
  })

  // One part: PART_SIZE bytes, or what's left for the last.
  .put("/:id/parts/:part", requireDownloader, async (c) => {
    const id = parseId(c.req.param("id"));
    const part = parseId(c.req.param("part"));
    if (!id || !part || part > 10_000) return c.json({ error: "Invalid part." }, 400);
    const log = await createDb(c.env.PIT_DB)
      .select()
      .from(matchLogs)
      .where(
        inTeam(matchLogs, c.get("teamId"), eq(matchLogs.id, id), eq(matchLogs.status, "uploading")),
      )
      .get();
    if (!log?.uploadId) return c.json({ error: "No upload of that log." }, 404);
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > PART_SIZE) {
      return c.json({ error: "A part is at most 10 MiB." }, 400);
    }
    const uploaded = await c.env.LOGS.resumeMultipartUpload(log.r2Key, log.uploadId).uploadPart(
      part,
      bytes,
    );
    return c.json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
  })

  // The parts, in order: the log is stored. With the team deleting its oldest when full, the
  // oldest beyond MAX_LOGS go now.
  .post("/:id/complete", requireDownloader, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const body = (await c.req.json().catch(() => null)) as {
      parts?: { partNumber: number; etag: string }[];
    } | null;
    if (!Array.isArray(body?.parts) || body.parts.length === 0) {
      return c.json({ error: "No parts." }, 400);
    }
    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    const log = await db
      .select()
      .from(matchLogs)
      .where(inTeam(matchLogs, teamId, eq(matchLogs.id, id), eq(matchLogs.status, "uploading")))
      .get();
    if (!log?.uploadId) return c.json({ error: "No upload of that log." }, 404);
    const object = await c.env.LOGS.resumeMultipartUpload(log.r2Key, log.uploadId)
      .complete(body.parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })))
      .catch(() => null);
    if (!object) return c.json({ error: "The parts didn't make the log." }, 400);
    if (object.size > MAX_SIZE) {
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

    if ((await getWhenFull(db, teamId)) === "delete-oldest") {
      const older = await db
        .select({ id: matchLogs.id })
        .from(matchLogs)
        .where(inTeam(matchLogs, teamId, eq(matchLogs.status, "stored"), ne(matchLogs.id, id)))
        .orderBy(desc(matchLogs.uploadedAt));
      await deleteLogs(
        db,
        c.env.LOGS,
        teamId,
        older.slice(MAX_LOGS - 1).map((row) => row.id),
      );
    }
    return c.json({ ok: true });
  });

/** Deletes every log file of a team (with its data, when the team or Pit goes). */
export async function deleteTeamLogFiles(bucket: R2Bucket, teamId: string) {
  for (;;) {
    const page = await bucket.list({ prefix: logsPrefix(teamId), limit: 1000 });
    if (page.objects.length === 0) return;
    await bucket.delete(page.objects.map((o) => o.key));
  }
}
