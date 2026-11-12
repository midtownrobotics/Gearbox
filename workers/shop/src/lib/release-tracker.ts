import { inTeam, withTeam } from "@g3/auth";
import { eq, inArray, isNull, lt, or } from "drizzle-orm";
import { createShopDb } from "../db";
import * as schema from "../db/schema";
import type { AppEnv } from "../types";
import { type OnshapeApi, type OnshapeCallKind, onshapeFetch } from "./onshape-api";
import { onshapeConfig } from "./onshape-config";
import {
  type FeatureSpec,
  type PartStatus,
  STATUS_LABELS,
  featureDefinition,
  featureSignature,
} from "./release-tracker-feature";
import { releasedKey, releasedStatuses } from "./release-tracker-status";

// The release tracker. An admin links a separate Onshape document (the tracking document), and
// Shop keeps a copy of every part studio of the team's Onshape document in it: one "Released
// parts" feature (release-tracker-feature.ts) per release version and status, each deriving its
// parts from that version and coloring them by how far along they are in the shop.
//
// Onshape's API allowance is limited, so syncs are batched and cheap:
// - Anything that could change a color (a release, a new version, a step changing in Shop) opens a
//   20-minute window (`openTrackerWindow`); one sync runs when it closes, on the queue.
// - Reading Onshape takes 3 calls plus one per version not seen before, and only happens when a
//   release or version came in (`refresh`). A window opened only by Shop's own changes reads
//   nothing: the parts are kept in D1 from the last read.
// - A feature is written only when what it should be (its signature) differs from what was
//   written, so a sync where no color changed makes no calls at all.

type ShopDb = ReturnType<typeof createShopDb>;
type Env = AppEnv["Bindings"];
type Tracker = typeof schema.releaseTrackers.$inferSelect;

/** How long a window stays open before its sync runs. */
export const WINDOW_SECONDS = 20 * 60;
/** A window whose sync never ran (a lost message) is opened again after this. */
const STALE_WINDOW_MS = 60 * 60 * 1000;
/** A sync that started this long ago and never finished no longer blocks the next one. */
const LOCK_MS = 15 * 60 * 1000;

/** The Name property of a tab in Onshape's metadata API. */
const NAME_PROPERTY = "57f3fb8efa3416c06701d60d";

export type TrackerSyncMessage = { kind: "release-tracker"; teamId: string };

export const isTrackerMessage = (body: unknown): body is TrackerSyncMessage =>
  typeof body === "object" &&
  body !== null &&
  (body as { kind?: unknown }).kind === "release-tracker" &&
  typeof (body as { teamId?: unknown }).teamId === "string";

/** A tracking document's address: `cad.onshape.com/documents/<document>/w/<workspace>/...`. */
export function parseTrackingUrl(url: string) {
  const m = url.trim().match(/\/documents\/([0-9a-f]{24})\/w\/([0-9a-f]{24})(?:[/?#]|$)/);
  return m ? { documentId: m[1], workspaceId: m[2] } : null;
}

/**
 * Opens the team's sync window if it has a tracker and none is open; with `refresh`, the sync will
 * read Onshape again. Called after anything that could change a color.
 */
export async function openTrackerWindow(
  env: Env,
  db: ShopDb,
  teamId: string,
  { refresh }: { refresh: boolean },
) {
  const t = schema.releaseTrackers;
  const now = Date.now();
  const opened = await db
    .update(t)
    .set({ syncDueAt: now + WINDOW_SECONDS * 1000, ...(refresh && { refresh: 1 }) })
    .where(inTeam(t, teamId, or(isNull(t.syncDueAt), lt(t.syncDueAt, now - STALE_WINDOW_MS))))
    .returning({ id: t.id });
  if (opened.length > 0) {
    await env.BOM_QUEUE.send({ kind: "release-tracker", teamId } satisfies TrackerSyncMessage, {
      delaySeconds: WINDOW_SECONDS,
    });
  } else if (refresh) {
    // A window is open already (or there's no tracker): its sync reads Onshape too.
    await db.update(t).set({ refresh: 1 }).where(inTeam(t, teamId));
  }
}

/** Sync now: reads Onshape and syncs right away, whether or not a window is open. */
export async function syncTrackerNow(env: Env, db: ShopDb, teamId: string) {
  const t = schema.releaseTrackers;
  await db.update(t).set({ refresh: 1 }).where(inTeam(t, teamId));
  await env.BOM_QUEUE.send({ kind: "release-tracker", teamId } satisfies TrackerSyncMessage);
}

/** A problem worth showing an admin as it is. */
class TrackerError extends Error {}

/** Onshape refused a call. */
class OnshapeCallError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function onshapeJson<T>(
  api: OnshapeApi,
  kind: OnshapeCallKind,
  path: string,
  init?: { method: string; body?: unknown },
): Promise<T> {
  const response = await onshapeFetch(api, kind, path, {
    method: init?.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(init?.body !== undefined && { "Content-Type": "application/json" }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = text.slice(0, 200);
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {}
    throw new OnshapeCallError(response.status, `Onshape answered ${response.status}: ${message}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * The queue's sync for one team. Returns "busy" when another sync is running (the message is
 * tried again later).
 */
export async function runTrackerSync(env: Env, teamId: string): Promise<"done" | "busy" | "none"> {
  const db = createShopDb(env.SHOP_DB);
  const t = schema.releaseTrackers;
  const existing = await db.select({ id: t.id }).from(t).where(inTeam(t, teamId)).get();
  if (!existing) return "none";

  const now = Date.now();
  const [tracker] = await db
    .update(t)
    .set({ syncStartedAt: now })
    .where(inTeam(t, teamId, or(isNull(t.syncStartedAt), lt(t.syncStartedAt, now - LOCK_MS))))
    .returning();
  if (!tracker) return "busy";

  // Close the window: a change from here on opens a new one.
  await db.update(t).set({ syncDueAt: null, refresh: 0 }).where(inTeam(t, teamId));
  const refresh = tracker.refresh === 1 || !tracker.sourceVersionId;

  try {
    const config = await onshapeConfig(env, db, teamId);
    if (!config.credentials) throw new TrackerError("Add Onshape API keys on the Admin page.");
    if (config.documentId !== tracker.sourceDocumentId) {
      throw new TrackerError(
        "Shop follows a different Onshape document now. Set up the release tracker again.",
      );
    }
    const api = { db, teamId, credentials: config.credentials };
    const versionId = refresh
      ? await readSource(api, tracker)
      : (tracker.sourceVersionId as string);
    await writeCopies(api, tracker, versionId);
    await db
      .update(t)
      .set({ syncedAt: Date.now(), sourceVersionId: versionId, error: null, syncStartedAt: null })
      .where(inTeam(t, teamId));
  } catch (err) {
    console.error("[Release tracker] Sync failed", { teamId }, err);
    const message =
      err instanceof TrackerError || err instanceof OnshapeCallError
        ? err.message
        : "The sync didn't finish.";
    // What wasn't read is read next time.
    await db
      .update(t)
      .set({ error: message, syncStartedAt: null, ...(refresh && { refresh: 1 }) })
      .where(inTeam(t, teamId));
  }
  return "done";
}

type OnshapePart = {
  partId?: string;
  elementId?: string;
  name?: string;
  partNumber?: string | null;
  bodyType?: string;
  isFlattenedBody?: boolean;
};

type OnshapeRevision = {
  partNumber?: string;
  revision?: string;
  partId?: string;
  elementId?: string;
  elementType?: number;
  versionId?: string;
  releaseName?: string;
  releaseCreatedDate?: string;
  isObsolete?: boolean;
};

type OnshapeElement = { id: string; name: string; microversionId: string };

/** The part studios at a version of the team's document, kept for their microversions. */
async function partStudiosAt(api: OnshapeApi, documentId: string, versionId: string) {
  const elements = await onshapeJson<OnshapeElement[]>(
    api,
    "tracker_elements",
    `/v10/documents/d/${documentId}/v/${versionId}/elements?elementType=PARTSTUDIO`,
  );
  for (const e of elements) {
    await api.db
      .insert(schema.releaseTrackerVersions)
      .values(
        withTeam(api.teamId, { versionId, elementId: e.id, microversionId: e.microversionId }),
      )
      .onConflictDoNothing();
  }
  return elements;
}

/**
 * Reads the team's document: its newest version, the part studios and parts in it, and the latest
 * release of each part. Keeps them in D1 and returns the newest version.
 */
async function readSource(api: OnshapeApi, tracker: Tracker) {
  const { db, teamId } = api;
  const documentId = tracker.sourceDocumentId;
  const doc = await onshapeJson<{ defaultWorkspace?: { parent?: string | null } }>(
    api,
    "tracker_document",
    `/v10/documents/${documentId}`,
  );
  // The main workspace's parent is the newest version made from it.
  const versionId = doc.defaultWorkspace?.parent;
  if (!versionId) {
    throw new TrackerError(
      "Make a version of the Onshape document first: parts are copied from versions.",
    );
  }

  const [parts, revisions, studios] = await Promise.all([
    onshapeJson<OnshapePart[]>(
      api,
      "tracker_parts",
      `/v10/parts/d/${documentId}/v/${versionId}?withThumbnails=false`,
    ),
    onshapeJson<OnshapeRevision[] | { items?: OnshapeRevision[] }>(
      api,
      "tracker_revisions",
      `/v10/revisions/d/${documentId}`,
    ),
    partStudiosAt(api, documentId, versionId),
  ]);

  // Each part number's latest revision in a part studio. One that's obsolete means the part is
  // no longer released.
  const released = (Array.isArray(revisions) ? revisions : (revisions.items ?? []))
    .filter((r) => r.elementType === 0 && r.partNumber && r.partId && r.elementId && r.versionId)
    .sort((a, b) => (a.releaseCreatedDate ?? "").localeCompare(b.releaseCreatedDate ?? ""));
  const byNumber = new Map<string, OnshapeRevision>();
  for (const r of released) byNumber.set(r.partNumber as string, r);
  const byPart = new Map<string, OnshapeRevision>();
  for (const r of byNumber.values()) {
    if (!r.isObsolete) byPart.set(`${r.elementId}\n${r.partId}`, r);
  }

  const rows = parts
    .filter((p) => p.bodyType === "solid" && !p.isFlattenedBody && p.partId && p.elementId)
    .map((p) => {
      const byItsNumber = p.partNumber ? byNumber.get(p.partNumber) : undefined;
      const r =
        byItsNumber && !byItsNumber.isObsolete
          ? byItsNumber
          : byPart.get(`${p.elementId}\n${p.partId}`);
      return withTeam(teamId, {
        sourceElementId: p.elementId as string,
        partId: p.partId as string,
        name: p.name ?? null,
        partNumber: r?.partNumber ?? null,
        revision: r ? (r.revision ?? null) : null,
        releaseName: r?.releaseName ?? null,
        versionId: r?.versionId ?? versionId,
        fromElementId: r?.elementId ?? (p.elementId as string),
        fromPartId: r?.partId ?? (p.partId as string),
      });
    });

  // The parts as read, in place of the last read's (11 values a row; D1 takes 100 a statement).
  const p = schema.releaseTrackerParts;
  await db.delete(p).where(inTeam(p, teamId));
  for (let i = 0; i < rows.length; i += 8) {
    await db
      .insert(p)
      .values(rows.slice(i, i + 8))
      .onConflictDoNothing();
  }

  // The part studios: new ones get a copy next, renamed ones a new name, and gone ones lose theirs.
  const s = schema.releaseTrackerStudios;
  for (const studio of studios) {
    await db
      .insert(s)
      .values(withTeam(teamId, { sourceElementId: studio.id, name: studio.name }))
      .onConflictDoUpdate({
        target: [s.teamId, s.sourceElementId],
        set: { name: studio.name, removed: 0 },
      });
  }
  const current = new Set(studios.map((studio) => studio.id));
  for (const studio of await db.select().from(s).where(inTeam(s, teamId)).all()) {
    if (!current.has(studio.sourceElementId)) {
      await db
        .update(s)
        .set({ removed: 1 })
        .where(inTeam(s, teamId, eq(s.id, studio.id)));
    }
  }
  return versionId;
}

/** Each part studio's microversion at each version the copies take parts from. */
async function microversions(
  api: OnshapeApi,
  documentId: string,
  versionIds: string[],
): Promise<Map<string, string>> {
  const v = schema.releaseTrackerVersions;
  const known = new Map<string, string>();
  const read = async () => {
    for (let i = 0; i < versionIds.length; i += 80) {
      const rows = await api.db
        .select()
        .from(v)
        .where(inTeam(v, api.teamId, inArray(v.versionId, versionIds.slice(i, i + 80))))
        .all();
      for (const row of rows) known.set(`${row.versionId}\n${row.elementId}`, row.microversionId);
    }
  };
  await read();
  const seen = new Set([...known.keys()].map((k) => k.split("\n")[0]));
  const missing = versionIds.filter((id) => !seen.has(id));
  for (const versionId of missing) await partStudiosAt(api, documentId, versionId);
  if (missing.length > 0) await read();
  return known;
}

/** The features a part studio's copy should have, by group: release version and status. */
function desiredFeatures(
  documentId: string,
  parts: (typeof schema.releaseTrackerParts.$inferSelect)[],
  statuses: Map<string, PartStatus>,
  microversionOf: Map<string, string>,
) {
  const groups = new Map<string, FeatureSpec>();
  for (const part of parts) {
    const status: PartStatus = part.partNumber
      ? (statuses.get(releasedKey(part.partNumber, part.revision)) ?? "NOT_STARTED")
      : "UNRELEASED";
    const key = `${status}\n${part.versionId}\n${part.fromElementId}`;
    const group = groups.get(key);
    if (group) {
      group.partIds.push(part.fromPartId);
      continue;
    }
    const microversionId = microversionOf.get(`${part.versionId}\n${part.fromElementId}`);
    // A part studio Onshape didn't list at that version: nothing can point at it.
    if (!microversionId) continue;
    groups.set(key, {
      name:
        status === "UNRELEASED"
          ? STATUS_LABELS.UNRELEASED
          : `${STATUS_LABELS[status]} · ${part.releaseName ?? "Release"}`,
      source: {
        documentId,
        versionId: part.versionId,
        elementId: part.fromElementId,
        microversionId,
      },
      partIds: [part.fromPartId],
      status,
    });
  }
  return groups;
}

/** Brings every copy up to date, writing only what changed. A part studio's problem is its own. */
async function writeCopies(api: OnshapeApi, tracker: Tracker, versionId: string) {
  const { db, teamId } = api;
  const s = schema.releaseTrackerStudios;
  const f = schema.releaseTrackerFeatures;
  const studios = await db.select().from(s).where(inTeam(s, teamId)).all();
  const parts = await db
    .select()
    .from(schema.releaseTrackerParts)
    .where(inTeam(schema.releaseTrackerParts, teamId))
    .all();
  const statuses = await releasedStatuses(
    db,
    teamId,
    parts.flatMap((p) =>
      p.partNumber ? [{ partNumber: p.partNumber, revision: p.revision }] : [],
    ),
  );
  const microversionOf = await microversions(api, tracker.sourceDocumentId, [
    ...new Set([versionId, ...parts.map((p) => p.versionId)]),
  ]);
  const doc = `d/${tracker.documentId}/w/${tracker.workspaceId}`;

  for (const studio of studios) {
    const setStudio = (values: Partial<typeof s.$inferInsert>) =>
      db
        .update(s)
        .set(values)
        .where(inTeam(s, teamId, eq(s.id, studio.id)));
    const forgetFeatures = () =>
      db.delete(f).where(inTeam(f, teamId, eq(f.sourceElementId, studio.sourceElementId)));

    try {
      if (studio.removed) {
        if (studio.elementId) {
          await onshapeJson(api, "tracker_studio", `/v10/elements/${doc}/e/${studio.elementId}`, {
            method: "DELETE",
          }).catch((err) => {
            // Already deleted by hand.
            if (!(err instanceof OnshapeCallError && err.status === 404)) throw err;
          });
        }
        await forgetFeatures();
        await db.delete(s).where(inTeam(s, teamId, eq(s.id, studio.id)));
        continue;
      }

      const desired = desiredFeatures(
        tracker.sourceDocumentId,
        parts.filter((p) => p.sourceElementId === studio.sourceElementId),
        statuses,
        microversionOf,
      );

      // Once more if the copy turns out to have been deleted by hand: make it again.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          let elementId = studio.elementId;
          if (!elementId) {
            const made = await onshapeJson<{ id: string }>(
              api,
              "tracker_studio",
              `/v10/partstudios/${doc}`,
              { method: "POST", body: { name: studio.name } },
            );
            elementId = made.id;
            studio.elementId = elementId;
            studio.copyName = studio.name;
            await setStudio({ elementId, copyName: studio.name });
          } else if (studio.copyName !== studio.name) {
            await onshapeJson(api, "tracker_studio", `/v10/metadata/${doc}/e/${elementId}`, {
              method: "POST",
              body: { properties: [{ propertyId: NAME_PROPERTY, value: studio.name }] },
            });
            studio.copyName = studio.name;
            await setStudio({ copyName: studio.name });
          }
          const failed = await writeFeatures(api, doc, studio.sourceElementId, elementId, desired);
          await setStudio({
            syncedAt: Date.now(),
            error: failed ? `Onshape couldn't build ${failed}. Check the copy in Onshape.` : null,
          });
          break;
        } catch (err) {
          if (attempt === 0 && err instanceof OnshapeCallError && err.status === 404) {
            studio.elementId = null;
            await setStudio({ elementId: null, copyName: null });
            await forgetFeatures();
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      console.error("[Release tracker] Part studio not synced", studio.name, err);
      await setStudio({
        error: err instanceof OnshapeCallError ? err.message : "This part studio didn't sync.",
      });
    }
  }
}

type FeatureAnswer = {
  feature?: { featureId?: string; message?: { featureId?: string } };
  featureState?: { featureStatus?: string };
};

/**
 * Adds, rewrites and deletes one copy's features so they match `desired`. Returns the name of a
 * feature Onshape couldn't build, if any.
 */
async function writeFeatures(
  api: OnshapeApi,
  doc: string,
  sourceElementId: string,
  elementId: string,
  desired: Map<string, FeatureSpec>,
) {
  const { db, teamId } = api;
  const f = schema.releaseTrackerFeatures;
  const path = `/v10/partstudios/${doc}/e/${elementId}/features`;
  const written = await db
    .select()
    .from(f)
    .where(inTeam(f, teamId, eq(f.sourceElementId, sourceElementId)))
    .all();
  const byKey = new Map(written.map((w) => [w.groupKey, w]));
  // Features no group needs any more. A new group rewrites one of them in place (a part that
  // moved on in the shop is one call, not an add and a delete); the rest are deleted.
  const unused = written.filter((w) => !desired.has(w.groupKey));
  let failed: string | null = null;

  for (const [groupKey, spec] of desired) {
    const signature = featureSignature(spec);
    const own = byKey.get(groupKey);
    if (own?.signature === signature) continue;
    const before = own ?? unused.shift();
    const answer = await onshapeJson<FeatureAnswer>(
      api,
      "tracker_feature",
      before ? `${path}/featureid/${before.featureId}` : path,
      {
        method: "POST",
        body: {
          btType: "BTFeatureDefinitionCall-1406",
          feature: featureDefinition(spec, before?.featureId),
        },
      },
    );
    if (answer.featureState?.featureStatus === "ERROR") failed ??= spec.name;
    const featureId =
      answer.feature?.featureId ?? answer.feature?.message?.featureId ?? before?.featureId;
    if (!featureId) continue;
    if (before) {
      await db
        .update(f)
        .set({ groupKey, featureId, signature })
        .where(inTeam(f, teamId, eq(f.id, before.id)));
    } else {
      await db
        .insert(f)
        .values(withTeam(teamId, { sourceElementId, groupKey, featureId, signature }));
    }
  }

  for (const w of unused) {
    await onshapeJson(api, "tracker_feature", `${path}/featureid/${w.featureId}`, {
      method: "DELETE",
    }).catch((err) => {
      // Already deleted by hand.
      if (!(err instanceof OnshapeCallError && err.status === 404)) throw err;
    });
    await db.delete(f).where(inTeam(f, teamId, eq(f.id, w.id)));
  }
  return failed;
}

/** Every tracker table, children first: for stopping the tracker and deleting a team. */
export const TRACKER_TABLES = [
  schema.releaseTrackerFeatures,
  schema.releaseTrackerParts,
  schema.releaseTrackerVersions,
  schema.releaseTrackerStudios,
  schema.releaseTrackers,
] as const;

/** Forgets the tracker. The tracking document in Onshape is left as it is. */
export async function stopTracker(db: ShopDb, teamId: string) {
  for (const table of TRACKER_TABLES) await db.delete(table).where(inTeam(table, teamId));
}

/** What the Admin page shows. */
export async function trackerReport(db: ShopDb, teamId: string, sourceDocumentId: string | null) {
  const t = schema.releaseTrackers;
  const tracker = await db.select().from(t).where(inTeam(t, teamId)).get();
  if (!tracker) return null;
  const studios = await db
    .select()
    .from(schema.releaseTrackerStudios)
    .where(
      inTeam(schema.releaseTrackerStudios, teamId, eq(schema.releaseTrackerStudios.removed, 0)),
    )
    .all();
  const parts = await db
    .select({
      sourceElementId: schema.releaseTrackerParts.sourceElementId,
      partNumber: schema.releaseTrackerParts.partNumber,
    })
    .from(schema.releaseTrackerParts)
    .where(inTeam(schema.releaseTrackerParts, teamId))
    .all();
  const count = (id: string, released: boolean) =>
    parts.filter((p) => p.sourceElementId === id && Boolean(p.partNumber) === released).length;
  return {
    documentId: tracker.documentId,
    workspaceId: tracker.workspaceId,
    url: `https://cad.onshape.com/documents/${tracker.documentId}/w/${tracker.workspaceId}`,
    syncedAt: tracker.syncedAt,
    syncDueAt: tracker.syncDueAt,
    syncing: tracker.syncStartedAt !== null && tracker.syncStartedAt > Date.now() - LOCK_MS,
    error: tracker.error,
    otherDocument: sourceDocumentId !== tracker.sourceDocumentId,
    studios: studios
      .map((studio) => ({
        name: studio.name,
        url: studio.elementId
          ? `https://cad.onshape.com/documents/${tracker.documentId}/w/${tracker.workspaceId}/e/${studio.elementId}`
          : null,
        released: count(studio.sourceElementId, true),
        unreleased: count(studio.sourceElementId, false),
        syncedAt: studio.syncedAt,
        error: studio.error,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
