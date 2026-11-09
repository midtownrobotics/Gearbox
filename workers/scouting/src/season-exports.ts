// SPDX-License-Identifier: AGPL-3.0-only
import { type StorageFile, inTeam, listStorageObjects, storageArchive, withTeam } from "@g3/auth";
import {
  SEASON_ARCHIVE_BYTES,
  type SeasonExport,
  type SeasonResetResult,
  seasonHash,
  seasonJSON,
  validSeasonYear,
} from "@g3/auth/season-export";
import { eq, isNull, lte, or } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { createDb } from "./db";
import { scoutingForms, seasonExportParts, seasonExports, strategyEventConfig } from "./db/schema";
import { drawingArchiveAssets } from "./drawing-storage";
import {
  type SeasonRef,
  SeasonReviewError,
  type SeasonRow,
  definition,
  matchRow,
  noRemainingChildren,
  refKey,
  rowFileKeys,
  rowKey,
  rowRef,
  safeSeasonRow,
  seasonCandidates,
  seasonRows,
  seasonTables,
} from "./season-data";
import type { AppEnv } from "./types";

type FileRef = StorageFile & { etag: string };
type Snapshot = { refs: SeasonRef[]; files: FileRef[]; missing: string[] };
const encoder = new TextEncoder();
const DAY = 24 * 60 * 60 * 1000;
function requestTeam(c: Context<AppEnv>): string {
  const teamId = c.req.param("teamId");
  if (!teamId) throw new Error("Team is required.");
  return teamId;
}
export const seasonNotes = [
  "Includes Scouting reports, drawings, auton routines, shared maps, robot profiles and photos, event schedules, service tickets, comments, tier lists and predictions you select.",
  "Official event keys identify the game year. Manual events and other items without a year need your selection; event dates and upload dates never decide which game it was.",
  "Accounts, settings, permissions, API keys, form templates, points balances and points history stay. Shop, Pit and other apps are unchanged. Local drafts and maps on a device are not included.",
  "Each archive includes records and available files, plus form templates and the generic field image. Missing files are listed. There is no automatic restore; keep the archives somewhere safe.",
];

export async function expireSeasonExports(env: AppEnv["Bindings"]) {
  // tenancy: all teams (temporary export receipts expire after one day; no team data/files are deleted)
  await createDb(env.SCOUTING_DB)
    .delete(seasonExports)
    .where(lte(seasonExports.expiresAt, Date.now()));
}
async function getExport(
  env: AppEnv["Bindings"],
  teamId: string,
  id: string,
): Promise<SeasonExport | null> {
  const db = createDb(env.SCOUTING_DB);
  const job = await db
    .select()
    .from(seasonExports)
    .where(inTeam(seasonExports, teamId, eq(seasonExports.id, id)))
    .get();
  if (!job || job.expiresAt <= Date.now()) return null;
  const parts = await db
    .select()
    .from(seasonExportParts)
    .where(inTeam(seasonExportParts, teamId, eq(seasonExportParts.exportId, id)))
    .orderBy(seasonExportParts.part);
  return {
    id,
    year: job.year,
    expiresAt: job.expiresAt,
    parts: parts.map((part) => {
      const snapshot = JSON.parse(part.snapshotJSON) as Snapshot;
      return {
        index: part.part,
        records: snapshot.refs.length,
        files: snapshot.files.length,
        bytes: snapshot.files.reduce((n, file) => n + file.bytes, 0),
        archiveHash: part.archiveHash,
        archiveSize: part.archiveSize,
        result: part.resultJSON ? (JSON.parse(part.resultJSON) as SeasonResetResult) : null,
      };
    }),
  };
}
function currentRows(rows: Record<string, Record<string, unknown>[]>) {
  const indexed = new Map<string, SeasonRow>();
  for (const [table, values] of Object.entries(rows))
    for (const data of values) {
      const row = { table, data };
      indexed.set(refKey({ table, key: rowKey(row) }), row);
    }
  return indexed;
}

/** Binding-only API. Platform supplies the authenticated team and enforces non-kiosk admin access. */
export const seasonExportRoutes = new Hono<AppEnv>()
  .onError((error, c) => {
    if (error instanceof SeasonReviewError) return c.json({ error: error.message }, 400);
    if (error instanceof SyntaxError)
      return c.json(
        { error: "The season request is invalid. Review your selection and try again." },
        400,
      );
    console.error("Season operation failed", error.name);
    return c.json(
      {
        error:
          "The season operation could not finish. Keep your archives and resume this export before starting another.",
      },
      503,
    );
  })
  .get("/", async (c) => {
    const year = Number(c.req.query("year"));
    if (!validSeasonYear(year))
      return c.json({ error: "Choose a game year from 1992 to 2200." }, 400);
    const rows = await seasonRows(createDb(c.env.SCOUTING_DB), requestTeam(c));
    return c.json({
      year,
      items: seasonCandidates(rows)
        .filter((item) => item.year === null || item.year === year)
        .map(({ rows: _rows, ...item }) => item),
      notes: seasonNotes,
    });
  })
  .post("/exports", async (c) => {
    const body = await c.req.json<{ year?: unknown; selection?: unknown }>();
    if (
      !validSeasonYear(body.year) ||
      !Array.isArray(body.selection) ||
      !body.selection.length ||
      body.selection.length > 10000 ||
      !body.selection.every((key) => typeof key === "string" && key.length < 1000)
    )
      return c.json({ error: "Choose a year and the items to export." }, 400);
    const teamId = requestTeam(c);
    const db = createDb(c.env.SCOUTING_DB);
    const wanted = new Set(body.selection as string[]);
    const selected = seasonCandidates(await seasonRows(db, teamId)).filter(
      (item) => wanted.has(item.key) && (item.year === null || item.year === body.year),
    );
    if (selected.length !== wanted.size)
      return c.json({ error: "The selection changed. Review the season again." }, 409);
    const rows = selected
      .flatMap((item) => item.rows)
      .sort(
        (a, b) =>
          seasonTables.indexOf(definition(a.table)) - seasonTables.indexOf(definition(b.table)) ||
          refKey({ table: a.table, key: rowKey(a) }).localeCompare(
            refKey({ table: b.table, key: rowKey(b) }),
          ),
      );
    if (rows.length > 10000)
      return c.json(
        {
          error: "Choose fewer than 10,000 records per export. You can export the rest afterward.",
        },
        400,
      );
    const prefix = `teams/${encodeURIComponent(teamId)}/`;
    const objects = new Map(
      (await listStorageObjects(c.env.FIELD_MAPS, prefix)).map((file) => [file.key, file]),
    );
    const parts: Snapshot[] = [];
    let part: Snapshot = { refs: [], files: [], missing: [] };
    let dataBytes = 0;
    for (const row of rows) {
      const files: FileRef[] = [];
      const missing: string[] = [];
      for (const key of rowFileKeys(row)) {
        if (key.startsWith("teams/") && !key.startsWith(prefix))
          return c.json(
            { error: "A file has an invalid team reference. Nothing was removed." },
            409,
          );
        let object: R2Object | null | undefined = objects.get(key);
        // Legacy objects are authorized by their owned database row, never arbitrary input.
        if (!key.startsWith("teams/")) object = await c.env.FIELD_MAPS.head(key);
        if (!object) {
          missing.push(key);
          continue;
        }
        files.push({
          key,
          name: key.split("/").pop() || "file",
          bytes: object.size,
          uploadedAt: object.uploaded.getTime(),
          eligible: false,
          etag: object.etag,
        });
      }
      const rowBytes = encoder.encode(seasonJSON(safeSeasonRow(row))).length;
      const fileBytes = files.reduce((n, file) => n + file.bytes, 0);
      if (rowBytes > 1024 ** 2 || fileBytes > SEASON_ARCHIVE_BYTES || files.length > 100)
        return c.json(
          {
            error:
              "An item is too large for a verified season archive. Download it separately and contact support before resetting it.",
          },
          400,
        );
      const newFiles = files.filter(
        (file) => !part.files.some((existing) => existing.key === file.key),
      );
      if (
        part.refs.length &&
        (part.refs.length >= 100 ||
          dataBytes + rowBytes > 1024 ** 2 ||
          part.files.length + newFiles.length > 100 ||
          part.files.reduce((n, file) => n + file.bytes, 0) +
            newFiles.reduce((n, file) => n + file.bytes, 0) >
            SEASON_ARCHIVE_BYTES)
      ) {
        parts.push(part);
        part = { refs: [], files: [], missing: [] };
        dataBytes = 0;
      }
      part.refs.push(await rowRef(row));
      for (const file of files)
        if (!part.files.some((existing) => existing.key === file.key)) part.files.push(file);
      part.missing.push(...missing);
      dataBytes += rowBytes;
    }
    if (part.refs.length) parts.push(part);
    const snapshots = parts.map((part) => JSON.stringify(part));
    if (snapshots.reduce((n, json) => n + encoder.encode(json).length, 0) > 4 * 1024 ** 2)
      return c.json({ error: "Choose a smaller selection for this export." }, 400);
    // One unfinished export per team, kept for 24 hours. No duplicate R2 backup is stored.
    await expireSeasonExports(c.env);
    const existing = await db
      .select({ id: seasonExports.id })
      .from(seasonExports)
      .where(inTeam(seasonExports, teamId));
    if (existing.length)
      return c.json(
        {
          error: "Finish or discard the current export before starting another.",
          exportId: existing[0].id,
        },
        409,
      );
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.batch([
      db
        .insert(seasonExports)
        .values(withTeam(teamId, { id, year: body.year, createdAt: now, expiresAt: now + DAY })),
      ...snapshots.map((snapshotJSON, index) =>
        db
          .insert(seasonExportParts)
          .values(withTeam(teamId, { exportId: id, part: index, snapshotJSON })),
      ),
    ]);
    return c.json(await getExport(c.env, teamId, id), 201);
  })
  .get("/exports", async (c) => {
    const teamId = requestTeam(c);
    const jobs = await createDb(c.env.SCOUTING_DB)
      .select({
        id: seasonExports.id,
        year: seasonExports.year,
        expiresAt: seasonExports.expiresAt,
      })
      .from(seasonExports)
      .where(inTeam(seasonExports, teamId));
    return c.json({ exports: jobs.filter((job) => job.expiresAt > Date.now()) });
  })
  .get("/exports/:id", async (c) => {
    const job = await getExport(c.env, requestTeam(c), c.req.param("id"));
    return job
      ? c.json(job)
      : c.json({ error: "Export not found or expired. Start a new export." }, 404);
  })
  .delete("/exports/:id", async (c) => {
    const db = createDb(c.env.SCOUTING_DB);
    const teamId = requestTeam(c);
    // Do not discard an export while a reset request is using it.
    const parts = await db
      .select()
      .from(seasonExportParts)
      .where(inTeam(seasonExportParts, teamId, eq(seasonExportParts.exportId, c.req.param("id"))));
    if (parts.some((part) => part.resettingAt && part.resettingAt > Date.now() - 10 * 60 * 1000))
      return c.json({ error: "A reset is still running. Try again shortly." }, 409);
    await db
      .delete(seasonExports)
      .where(inTeam(seasonExports, teamId, eq(seasonExports.id, c.req.param("id"))));
    return c.json({ ok: true });
  })
  .post("/exports/:id/:part/:action", async (c) => {
    const teamId = requestTeam(c);
    const id = c.req.param("id");
    const index = Number(c.req.param("part"));
    const action = c.req.param("action");
    if (!Number.isInteger(index) || index < 0 || !["archive", "reset"].includes(action))
      return c.json({ error: "Export part not found." }, 404);
    const db = createDb(c.env.SCOUTING_DB);
    const job = await getExport(c.env, teamId, id);
    if (!job) return c.json({ error: "Export not found or expired. Start a new export." }, 404);
    const where = inTeam(
      seasonExportParts,
      teamId,
      eq(seasonExportParts.exportId, id),
      eq(seasonExportParts.part, index),
    );
    const saved = await db
      .select()
      .from(seasonExportParts)
      .where(inTeam(seasonExportParts, teamId, where))
      .get();
    if (!saved) return c.json({ error: "Export part not found." }, 404);
    const snapshot = JSON.parse(saved.snapshotJSON) as Snapshot;
    if (action === "archive") {
      if (saved.resultJSON || saved.resettingAt)
        return c.json(
          { error: "Keep the archive you already downloaded; this part has started resetting." },
          409,
        );
      const indexed = currentRows(await seasonRows(db, teamId));
      const rows: SeasonRow[] = [];
      for (const ref of snapshot.refs) {
        const row = indexed.get(refKey(ref));
        if (!row || (await seasonHash(safeSeasonRow(row))) !== ref.hash)
          return c.json(
            {
              error:
                "Records changed after review. Discard this export and review the season again. Nothing was removed.",
            },
            409,
          );
        rows.push(safeSeasonRow(row));
      }
      const formIds = new Set(
        rows
          .filter((row) => row.table === "scouting_form_submissions")
          .map((row) => row.data.form_id),
      );
      const forms = (
        await db.select().from(scoutingForms).where(inTeam(scoutingForms, teamId))
      ).filter((form) => formIds.has(form.id));
      const data = encoder.encode(
        JSON.stringify(
          {
            format: "gearbox-season-export",
            version: 1,
            app: "scouting",
            teamId,
            year: job.year,
            exportId: id,
            part: index,
            rows,
            formTemplates: forms,
            missingFiles: snapshot.missing,
            notes: seasonNotes,
          },
          null,
          2,
        ),
      );
      if (
        data.length + drawingArchiveAssets.reduce((n, asset) => n + asset.bytes.length, 0) >
        3 * 1024 ** 2
      )
        return c.json(
          { error: "The archive's records are too large. Choose a smaller selection." },
          400,
        );
      return storageArchive(
        c.env.FIELD_MAPS,
        snapshot.files,
        `scouting-${job.year}-part-${index + 1}`,
        [{ name: "data.json", bytes: data }, ...drawingArchiveAssets],
        {
          etags: new Map(snapshot.files.map((file) => [file.key, file.etag])),
          async complete(hash, bytes) {
            await db
              .update(seasonExportParts)
              .set({ archiveHash: hash, archiveSize: bytes })
              .where(inTeam(seasonExportParts, teamId, where));
          },
        },
      );
    }
    const body = await c.req.json<{ archiveHash?: string; confirmation?: string }>();
    if (
      !saved.archiveHash ||
      body.archiveHash !== saved.archiveHash ||
      body.confirmation !== `RESET ${job.year}`
    )
      return c.json(
        { error: "Verify the saved archive and type the season confirmation before resetting." },
        400,
      );
    if (saved.resultJSON) return c.json(JSON.parse(saved.resultJSON) as SeasonResetResult);
    if (job.parts.some((part) => part.index < index && !part.result))
      return c.json({ error: "Reset earlier archive parts first." }, 409);
    const claim = await db
      .update(seasonExportParts)
      .set({ resettingAt: Date.now() })
      .where(
        inTeam(
          seasonExportParts,
          teamId,
          where,
          isNull(seasonExportParts.resultJSON),
          or(
            isNull(seasonExportParts.resettingAt),
            lte(seasonExportParts.resettingAt, Date.now() - 10 * 60 * 1000),
          ),
        ),
      )
      .returning({ part: seasonExportParts.part });
    if (!claim.length)
      return c.json({ error: "This part is already resetting. Try again shortly." }, 409);
    const result: SeasonResetResult = { removed: 0, kept: 0, filesRemoved: 0 };
    try {
      const indexed = currentRows(await seasonRows(db, teamId));
      const files = new Map(snapshot.files.map((file) => [file.key, file]));
      const removedKeys = new Set<string>();
      for (const ref of snapshot.refs) {
        const row = indexed.get(refKey(ref));
        if (!row) continue;
        if ((await seasonHash(safeSeasonRow(row))) !== ref.hash) {
          result.kept++;
          continue;
        }
        let changedFile = false;
        for (const key of rowFileKeys(row)) {
          const object = await c.env.FIELD_MAPS.head(key);
          if (object && object.etag !== files.get(key)?.etag) changedFile = true;
        }
        if (changedFile) {
          result.kept++;
          continue;
        }
        const table = definition(ref.table).table;
        const condition = inTeam(
          table,
          teamId,
          matchRow(table, row.data),
          ...noRemainingChildren(ref.table, teamId, row.data, db),
        );
        const removed =
          ref.table === "strategy_event_config"
            ? await db
                .update(strategyEventConfig)
                .set({ event_key: "", current_match_number: null, nexus_event_key: null })
                .where(inTeam(strategyEventConfig, teamId, condition))
                .returning({ id: strategyEventConfig.id })
            : await db.delete(table).where(condition).returning();
        if (!removed.length) {
          result.kept++;
          continue;
        }
        result.removed++;
        for (const key of rowFileKeys(row)) removedKeys.add(key);
      }
      const stillReferenced = new Set(
        Object.entries(await seasonRows(db, teamId)).flatMap(([table, values]) =>
          values.flatMap((data) => rowFileKeys({ table, data })),
        ),
      );
      for (const key of removedKeys) {
        const file = files.get(key);
        // Scouting's normal writers always mint fresh IDs/keys. Never touch an unknown version,
        // a file another record still uses, or a legacy object outside this team's namespace.
        if (
          !file ||
          stillReferenced.has(key) ||
          !key.startsWith(`teams/${encodeURIComponent(teamId)}/`)
        )
          continue;
        const current = await c.env.FIELD_MAPS.head(key);
        if (current?.etag !== file.etag) continue;
        await c.env.FIELD_MAPS.delete(key);
        result.filesRemoved++;
      }
      await db
        .update(seasonExportParts)
        .set({ resultJSON: JSON.stringify(result), resettingAt: null })
        .where(inTeam(seasonExportParts, teamId, where));
      return c.json(result);
    } finally {
      await db
        .update(seasonExportParts)
        .set({ resettingAt: null })
        .where(inTeam(seasonExportParts, teamId, where));
    }
  });
