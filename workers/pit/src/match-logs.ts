import { inTeam, requireAuth, requireMentor, withTeam } from "@g3/auth";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "./db";
import { logDownloaders, matchLogs } from "./db/schema";
import { requireDownloader } from "./downloaders";
import type { AppEnv } from "./types";

// Match logs: the AdvantageKit .wpilog files the team's paired log downloaders copy off the robot,
// kept in the LOGS bucket (Shop's) under pit/teams/<team>/logs/, outside Shop's own
// teams/<team>/, which Shop deletes when a team switches it off. A log goes up in parts (R2
// multipart): Workers refuse a request body over 100 MB, and a log can come near that.

/** Each part but the last; R2 needs at least 5 MiB, and every part but the last the same size. */
export const PART_SIZE = 10 * 1024 * 1024;
/** The largest log taken. */
const MAX_SIZE = 1024 * 1024 * 1024;

export const logsPrefix = (teamId: string) => `pit/teams/${teamId}/logs/`;
const logKey = (teamId: string, event: string, name: string) =>
  `${logsPrefix(teamId)}${event}/${name}.wpilog`;

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
  size: number;
  downloaderName: string;
  uploadedAt: number | null;
};

/** Pit's side (`/logs`): list, download, delete. */
export const matchLogRoutes = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const logs: MatchLog[] = await createDb(c.env.PIT_DB)
      .select({
        id: matchLogs.id,
        event: matchLogs.event,
        name: matchLogs.name,
        matchType: matchLogs.matchType,
        matchNumber: matchLogs.matchNumber,
        size: matchLogs.size,
        downloaderName: matchLogs.downloaderName,
        uploadedAt: matchLogs.uploadedAt,
      })
      .from(matchLogs)
      .where(inTeam(matchLogs, c.get("teamId"), eq(matchLogs.status, "stored")))
      .orderBy(desc(matchLogs.uploadedAt));
    return c.json({ logs, canDelete: c.get("userIsMentor") || c.get("userIsAdmin") });
  })

  .get("/:id/file", requireAuth, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const log = await createDb(c.env.PIT_DB)
      .select()
      .from(matchLogs)
      .where(
        inTeam(matchLogs, c.get("teamId"), eq(matchLogs.id, id), eq(matchLogs.status, "stored")),
      )
      .get();
    const object = log ? await c.env.LOGS.get(log.r2Key) : null;
    if (!log || !object) return c.json({ error: "Log not found." }, 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename="${log.event}-${log.name}.wpilog"`,
      },
    });
  })

  .delete("/:id", requireMentor, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const db = createDb(c.env.PIT_DB);
    const [removed] = await db
      .delete(matchLogs)
      .where(inTeam(matchLogs, c.get("teamId"), eq(matchLogs.id, id)))
      .returning({ r2Key: matchLogs.r2Key });
    if (!removed) return c.json({ error: "Log not found." }, 404);
    await c.env.LOGS.delete(removed.r2Key);
    return c.json({ ok: true });
  });

/** The downloader's side (`/downloader/logs`), with its key: start an upload, send parts, finish. */
export const logUploadRoutes = new Hono<AppEnv>()
  // Starts uploading a log, or says Pit already has it (the same event, name and size).
  .post("/", requireDownloader, async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const event = String(body?.event ?? "");
    const name = String(body?.name ?? "");
    const matchType = body?.matchType as (typeof TYPES)[number];
    const matchNumber = Number(body?.matchNumber);
    const size = Number(body?.size);
    if (
      !EVENT.test(event) ||
      !NAME.test(name) ||
      !TYPES.includes(matchType) ||
      !Number.isInteger(matchNumber) ||
      matchNumber < 0 ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > MAX_SIZE
    ) {
      return c.json({ error: "Not a match log Pit takes." }, 400);
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
      httpMetadata: { contentType: "application/octet-stream" },
    });
    const values = {
      matchType,
      matchNumber,
      size,
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

  // The parts, in order: the log is stored.
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
    await db
      .update(matchLogs)
      .set({ status: "stored", uploadId: null, size: object.size, uploadedAt: Date.now() })
      .where(inTeam(matchLogs, teamId, eq(matchLogs.id, id)));
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
