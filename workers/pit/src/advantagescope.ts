import {
  inTeam,
  logTeamChange,
  requestTeamId,
  requireAuth,
  requireMentor,
  withTeam,
} from "@g3/auth";
import { teamAppUrlVia } from "@g3/site-config";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "./db";
import { matchLogs, scopeAssets, scopeSettings } from "./db/schema";
import { multipartFile } from "./multipart";
import type { AppEnv } from "./types";
import { type ZipEntry, ZipError, readZip } from "./unzip";

// AdvantageScope Lite, served by Pit at /scope/ (built from vendor/advantagescope with
// apps/pit/advantagescope/gearbox.patch). These are the routes its Python server answers on a
// robot, at /api/scope: the team's match logs (./match-logs.ts) as its log folder, the team's
// uploaded assets, and its preferences and layout, which are the team's, not one browser's.

/** The most settings a team keeps, and the largest one (a layout is a few KiB). */
const MAX_SETTINGS = 40;
const MAX_SETTING = 512 * 1024;
/** localStorage keys AdvantageScope Lite uses ("AdvantageScopeLite/state"). */
const SETTING_KEY = /^AdvantageScopeLite\/[A-Za-z0-9._/-]{1,80}$/;

/** The largest asset zip taken, the most a team keeps in all, and how many assets. */
export const MAX_UPLOAD = 50 * 1024 * 1024;
export const MAX_ASSET_BYTES = 100 * 1024 * 1024;
export const MAX_ASSETS = 10;
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,99}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,99}$/;

export const scopePrefix = (teamId: string) => `pit/teams/${teamId}/scope-assets/`;
const assetKey = (teamId: string, name: string, file: string) =>
  `${scopePrefix(teamId)}${name}/${file}`;

/** A log's file name in AdvantageScope's Open Log list: "archimedes_Qual-13.wpilog". */
export const scopeLogName = (event: string, name: string) => `${event}_${name}.wpilog`;
const LOG_FILE = /^([A-Za-z0-9_-]{1,40})_((?:Qual|Elim|Prct)-\d{1,4})\.wpilog$/;

const CONTENT_TYPES: Record<string, string> = {
  glb: "model/gltf-binary",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  json: "application/json",
};

type AssetFile = { name: string; size: number };

/** An asset the team uploaded, as Pit's Logs page lists it. */
export type ScopeAsset = { name: string; size: number; uploadedAt: number };

/** The assets in an uploaded zip: each folder holding a config.json, with the files beside it. */
async function assetsIn(zip: ZipEntry[], zipName: string) {
  // A zip of asset zips (AdvantageScope's collections) is read one level down.
  const entries: { path: string; entry: ZipEntry }[] = [];
  for (const entry of zip) {
    const path = `${zipName}/${entry.path}`;
    if (path.split("/").some((part) => part.startsWith(".") || part === "__MACOSX")) continue;
    if (entry.path.toLowerCase().endsWith(".zip")) {
      if (entry.size > MAX_UPLOAD) throw new ZipError("A zip in the zip is over 50 MB.");
      for (const inner of readZip(await entry.read())) {
        entries.push({ path: `${path.slice(0, -4)}/${inner.path}`, entry: inner });
      }
    } else {
      entries.push({ path, entry });
    }
  }
  const folders = entries
    .filter(({ path }) => path.endsWith("/config.json"))
    .map(({ path }) => path.slice(0, -"/config.json".length));
  return folders.map((folder) => ({
    name: folder.split("/").pop() ?? "",
    files: entries
      .filter(({ path }) => path.slice(0, path.lastIndexOf("/")) === folder)
      .map(({ path, entry }) => ({ name: path.slice(folder.length + 1), entry })),
  }));
}

export const scopeRoutes = new Hono<AppEnv>()
  // Signed out: the team's ID sign-in page, coming back to AdvantageScope. Only a page under
  // /scope on this team's own Pit is gone back to.
  .get("/sign-in", (c) => {
    const teamId = requestTeamId(c);
    const gateway = c.env.LOCAL_GATEWAY_URL || undefined;
    let path = "/scope/";
    try {
      const back = new URL(c.req.query("return") ?? "");
      if (back.pathname.startsWith("/scope/")) path = back.pathname + back.search;
    } catch {}
    const returnTo = teamAppUrlVia(gateway, teamId, "pit") + path;
    return c.redirect(
      `${teamAppUrlVia(gateway, teamId, "id")}/login?redirect=${encodeURIComponent(returnTo)}`,
    );
  })

  // The team's preferences and layout, by localStorage key.
  .get("/settings", requireAuth, async (c) => {
    const rows = await createDb(c.env.PIT_DB)
      .select({ key: scopeSettings.key, value: scopeSettings.value })
      .from(scopeSettings)
      .where(inTeam(scopeSettings, c.get("teamId")));
    return c.json({ settings: Object.fromEntries(rows.map((row) => [row.key, row.value])) });
  })

  // Anyone signed in changes them, as they use AdvantageScope: the last save wins.
  .put("/settings", requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { settings?: unknown } | null;
    const changes = body?.settings;
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      return c.json({ error: "No settings." }, 400);
    }
    const entries = Object.entries(changes as Record<string, unknown>);
    if (entries.length === 0) return c.json({ ok: true });
    for (const [key, value] of entries) {
      if (!SETTING_KEY.test(key) || typeof value !== "string" || value.length > MAX_SETTING) {
        return c.json({ error: "Not a setting AdvantageScope keeps." }, 400);
      }
    }
    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    const existing = await db
      .select({ key: scopeSettings.key })
      .from(scopeSettings)
      .where(inTeam(scopeSettings, teamId));
    const keys = new Set([...existing.map((row) => row.key), ...entries.map(([key]) => key)]);
    if (keys.size > MAX_SETTINGS) return c.json({ error: "Too many settings." }, 400);
    const now = Date.now();
    const userId = c.get("userId");
    await db.batch(
      entries.map(([key, value]) =>
        db
          .insert(scopeSettings)
          .values(
            withTeam(teamId, { key, value: value as string, updatedBy: userId, updatedAt: now }),
          )
          .onConflictDoUpdate({
            target: [scopeSettings.teamId, scopeSettings.key],
            set: { value: value as string, updatedBy: userId, updatedAt: now },
          }),
      ) as [never, ...never[]],
    );
    return c.json({ ok: true });
  })

  // Open Log: the team's match logs, whatever folder AdvantageScope asks for.
  .get("/logs", requireAuth, async (c) => {
    const logs = await createDb(c.env.PIT_DB)
      .select({
        event: matchLogs.event,
        name: matchLogs.name,
        size: matchLogs.size,
        rawSize: matchLogs.rawSize,
      })
      .from(matchLogs)
      .where(inTeam(matchLogs, c.get("teamId"), eq(matchLogs.status, "stored")));
    return c.json(
      logs.map((log) => ({
        name: scopeLogName(log.event, log.name),
        size: log.rawSize ?? log.size,
      })),
    );
  })

  // One log as a .wpilog: stored gzipped, so the browser unzips it as it downloads.
  .get("/logs/:file", requireAuth, async (c) => {
    const match = LOG_FILE.exec(c.req.param("file"));
    const log = match
      ? await createDb(c.env.PIT_DB)
          .select({ r2Key: matchLogs.r2Key })
          .from(matchLogs)
          .where(
            inTeam(
              matchLogs,
              c.get("teamId"),
              eq(matchLogs.status, "stored"),
              eq(matchLogs.event, match[1]),
              eq(matchLogs.name, match[2]),
            ),
          )
          .get()
      : undefined;
    const object = log ? await c.env.LOGS.get(log.r2Key) : null;
    if (!object) return c.json({ error: "Log not found." }, 404);
    return new Response(object.body, {
      encodeBody: "manual",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "gzip",
        "Content-Length": String(object.size),
      },
    });
  })

  // The team's assets in AdvantageScope's index: each file's path, with config.json's contents.
  .get("/assets", requireAuth, async (c) => {
    const rows = await createDb(c.env.PIT_DB)
      .select()
      .from(scopeAssets)
      .where(inTeam(scopeAssets, c.get("teamId")));
    const index: Record<string, unknown> = {};
    for (const row of rows) {
      for (const file of JSON.parse(row.files) as AssetFile[]) {
        index[`${row.name}/${file.name}`] =
          file.name === "config.json" ? JSON.parse(row.config) : null;
      }
    }
    return c.json(index);
  })

  // For Pit's Logs page: what the team uploaded, and whether this person may change it.
  .get("/asset-list", requireAuth, async (c) => {
    const assets: ScopeAsset[] = await createDb(c.env.PIT_DB)
      .select({
        name: scopeAssets.name,
        size: scopeAssets.size,
        uploadedAt: scopeAssets.uploadedAt,
      })
      .from(scopeAssets)
      .where(inTeam(scopeAssets, c.get("teamId")))
      .orderBy(asc(scopeAssets.name));
    return c.json({
      assets,
      canManage: c.get("userIsMentor") || c.get("userIsAdmin"),
      limit: MAX_ASSET_BYTES,
    });
  })

  .get("/assets/:name/:file", requireAuth, async (c) => {
    const name = c.req.param("name");
    const file = c.req.param("file");
    const row = await createDb(c.env.PIT_DB)
      .select({ files: scopeAssets.files })
      .from(scopeAssets)
      .where(inTeam(scopeAssets, c.get("teamId"), eq(scopeAssets.name, name)))
      .get();
    const listed = row && (JSON.parse(row.files) as AssetFile[]).some((f) => f.name === file);
    const object = listed
      ? await c.env.LOGS.get(assetKey(c.get("teamId"), name, file), { onlyIf: c.req.raw.headers })
      : null;
    if (!object) return c.json({ error: "Asset not found." }, 404);
    const headers = {
      ETag: object.httpEtag,
      "Cache-Control": "private, no-cache",
      "Content-Type":
        CONTENT_TYPES[file.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream",
    };
    // Unchanged since the browser last had it.
    if (!("body" in object)) return new Response(null, { status: 304, headers });
    return new Response((object as R2ObjectBody).body, { headers });
  })

  // Upload Asset: a zip of one asset, or of several (each a folder or a zip of its own). An asset
  // with a name the team has replaces it. Mentors and admins only: everyone sees them.
  .post("/assets", requireMentor, async (c) => {
    // The zip is held once, as the request's body: up to MAX_UPLOAD, and nothing unzipped is
    // held whole (each file is checked, then streamed to R2), so it stays in a Worker's memory.
    if (Number(c.req.header("Content-Length") ?? 0) > MAX_UPLOAD + 64 * 1024) {
      return c.json({ error: "The zip is over 50 MB." }, 413);
    }
    const upload = multipartFile(
      new Uint8Array(await c.req.arrayBuffer()),
      c.req.header("Content-Type") ?? "",
      "file",
    );
    if (!upload || !upload.name.toLowerCase().endsWith(".zip")) {
      return c.json({ error: "Uploaded asset must be a zip." }, 400);
    }
    if (upload.bytes.length > MAX_UPLOAD) {
      return c.json({ error: "The zip is over 50 MB." }, 413);
    }
    let found: Awaited<ReturnType<typeof assetsIn>>;
    try {
      found = await assetsIn(readZip(upload.bytes), upload.name.slice(0, -4));
    } catch (err) {
      if (err instanceof ZipError) return c.json({ error: err.message }, 400);
      throw err;
    }
    if (found.length === 0) return c.json({ error: "The zip has no asset (no config.json)." }, 400);
    for (const asset of found) {
      if (!ASSET_NAME.test(asset.name) || asset.files.some((f) => !FILE_NAME.test(f.name))) {
        return c.json({ error: `"${asset.name}" isn't a name an asset can have.` }, 400);
      }
    }

    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    const existing = await db
      .select({ name: scopeAssets.name, size: scopeAssets.size, files: scopeAssets.files })
      .from(scopeAssets)
      .where(inTeam(scopeAssets, teamId));
    const replaced = new Set(found.map((asset) => asset.name));
    const kept = existing.filter((row) => !replaced.has(row.name));
    if (kept.length + found.length > MAX_ASSETS) {
      return c.json({ error: `A team keeps at most ${MAX_ASSETS} assets.` }, 409);
    }

    const total =
      kept.reduce((sum, row) => sum + row.size, 0) +
      found.reduce((sum, asset) => sum + asset.files.reduce((s, f) => s + f.entry.size, 0), 0);
    if (total > MAX_ASSET_BYTES) {
      return c.json({ error: "The team's assets would be over 100 MB." }, 413);
    }
    // Every file is unzipped once and checked against its stated size, and each config.json read,
    // before anything is stored, so a bad zip changes nothing.
    const configs = new Map<string, unknown>();
    try {
      for (const asset of found) {
        for (const file of asset.files) {
          if (file.name !== "config.json") {
            await file.entry.stream().pipeTo(new WritableStream());
            continue;
          }
          const text = new TextDecoder().decode(await file.entry.read());
          try {
            configs.set(asset.name, JSON.parse(text));
          } catch {
            return c.json({ error: `${asset.name}'s config.json isn't valid JSON.` }, 400);
          }
        }
      }
    } catch (err) {
      if (err instanceof ZipError) return c.json({ error: err.message }, 400);
      return c.json({ error: "The zip is damaged." }, 400);
    }

    const now = Date.now();
    const userId = c.get("userId");
    for (const asset of found) {
      const files: AssetFile[] = [];
      for (const file of asset.files) {
        // Streamed: unzipped into R2 a piece at a time, at the size checked above.
        const { readable, writable } = new FixedLengthStream(file.entry.size);
        const piping = file.entry.stream().pipeTo(writable);
        await c.env.LOGS.put(assetKey(teamId, asset.name, file.name), readable);
        await piping;
        files.push({ name: file.name, size: file.entry.size });
      }
      // Files of the version replaced that this one doesn't have.
      const before = existing.find((row) => row.name === asset.name);
      const gone = before
        ? (JSON.parse(before.files) as AssetFile[]).filter(
            (old) => !files.some((f) => f.name === old.name),
          )
        : [];
      if (gone.length) {
        await c.env.LOGS.delete(gone.map((f) => assetKey(teamId, asset.name, f.name)));
      }
      const values = {
        files: JSON.stringify(files),
        config: JSON.stringify(configs.get(asset.name)),
        size: files.reduce((sum, f) => sum + f.size, 0),
        uploadedBy: userId,
        uploadedAt: now,
      };
      await db
        .insert(scopeAssets)
        .values(withTeam(teamId, { name: asset.name, ...values }))
        .onConflictDoUpdate({ target: [scopeAssets.teamId, scopeAssets.name], set: values });
    }
    await logTeamChange(c.env, teamId, {
      userId,
      app: "pit",
      what: "AdvantageScope assets",
      changed: ["Uploaded assets"],
    });
    return c.json({ ok: true, assets: found.map((asset) => asset.name) });
  })

  .delete("/assets/:name", requireMentor, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    const name = c.req.param("name");
    const [removed] = await db
      .delete(scopeAssets)
      .where(inTeam(scopeAssets, teamId, eq(scopeAssets.name, name)))
      .returning({ files: scopeAssets.files });
    if (!removed) return c.json({ error: "Asset not found." }, 404);
    const files = JSON.parse(removed.files) as AssetFile[];
    if (files.length) await c.env.LOGS.delete(files.map((f) => assetKey(teamId, name, f.name)));
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "pit",
      what: "AdvantageScope assets",
      changed: ["Removed an asset"],
    });
    return c.json({ ok: true });
  });

/** Deletes every AdvantageScope asset file of a team (with its data, when the team or Pit goes). */
export async function deleteTeamScopeFiles(bucket: R2Bucket, teamId: string) {
  for (;;) {
    const page = await bucket.list({ prefix: scopePrefix(teamId), limit: 1000 });
    if (page.objects.length === 0) return;
    await bucket.delete(page.objects.map((o) => o.key));
  }
}
