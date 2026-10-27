import {
  inTeam,
  logTeamChange,
  requireAdmin,
  requireAuth,
  sendTeamMessage,
  withTeam,
} from "@g3/auth";
import { isDemoTeam } from "@g3/demo";
import { eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type ShopDb, createShopDb } from "../db";
import * as schema from "../db/schema";
import { addDemoRelease } from "../demo";
import { obsoleteFileIds } from "../lib/batches";
import {
  formatOverview,
  formatReflection,
  getOverviewStats,
  getReflectionStats,
} from "../lib/daily-summary";
import { type OnshapeConfig, onshapeConfig, saveOnshapeConfig } from "../lib/onshape-config";
import {
  type OnshapeDocument,
  followedDocument,
  latestReleasedPart,
  teamDocuments,
} from "../lib/onshape-documents";
import { exportDrawingAsPDF, storeDrawingInR2 } from "../lib/onshape-export";
import { registerOnShapeWebhook, unregisterOnShapeWebhooks } from "../lib/onshape-webhook";
import { removedError } from "../lib/removal";
import { SETTING, getSetting, isChannelId, setSetting } from "../lib/settings";
import { shopUrl } from "../lib/urls";
import type { AppEnv } from "../types";

const RELEASE_CHANNEL_KEY = SETTING.releaseChannel;
const SUMMARY_CHANNEL_KEY = SETTING.summaryChannel;

/** Where the team's Onshape webhook calls back: its own Shop address. */
const eventsUrl = (env: AppEnv["Bindings"], teamId: string) =>
  `${shopUrl(env, teamId)}/api/onshape/events`;

const documentJson = (d: OnshapeDocument) => ({
  id: d.id,
  documentId: d.documentId,
  mainAssemblyId: d.mainAssemblyId ?? "",
  projectId: d.projectId,
});

/** A document's fields as sent (each checked by its route): addresses or ids, and the project. */
const documentValidator = validator(
  "json",
  (value): { documentId?: unknown; mainAssemblyId?: unknown; projectId?: unknown } =>
    typeof value === "object" && value !== null ? value : {},
);

/**
 * An Onshape id as typed or pasted: the id itself, or an address with it after `/<part>/`
 * (`/documents/<id>/w/…` for a document, `/e/<id>` for an element). Null for nothing.
 */
function onshapeId(value: unknown, part: "documents" | "e"): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const found = value.match(new RegExp(`/${part}/([0-9a-f]{24})(?:[/?#]|$)`, "i"));
  return (found?.[1] ?? value.trim()).slice(0, 64);
}

/** The team's project by id, if it's one a new document may go to (not removed). */
async function liveProject(db: ShopDb, teamId: string, value: unknown) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) return { error: "Choose the project it's for." };
  const row = await db
    .select()
    .from(schema.projects)
    .where(inTeam(schema.projects, teamId, eq(schema.projects.id, id)))
    .get();
  if (!row) return { error: "That project doesn't exist." };
  if (row.archivedAt !== null) {
    return { error: removedError("project", [row]) ?? "That project was removed." };
  }
  return row;
}

type WebhookOutcome = "registered" | "failed" | "needs keys";

/**
 * Puts Shop's webhook on a document again: takes off any it has (so saving never adds a second),
 * then registers one at the team's current address.
 */
async function replaceWebhook(
  env: AppEnv["Bindings"],
  db: ShopDb,
  teamId: string,
  config: OnshapeConfig,
  document: OnshapeDocument,
): Promise<WebhookOutcome> {
  if (!config.credentials || !config.companyId) return "needs keys";
  const url = eventsUrl(env, teamId);
  const api = { db, teamId, credentials: config.credentials };
  await unregisterOnShapeWebhooks(document.documentId, api, url);
  try {
    await registerOnShapeWebhook(document.documentId, api, config.companyId, url);
    return "registered";
  } catch (err) {
    console.error("[OnShape Config] Webhook registration failed", err);
    return "failed";
  }
}

export const adminPartsRouter = new Hono<AppEnv>()
  .get("/parts/pending", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");

    // Get all parts from onshapeParts and partDefinitions
    const [onshapeParts, definitions, allSubsystems, allReleases, projects] = await Promise.all([
      db.select().from(schema.onshapeParts).where(inTeam(schema.onshapeParts, teamId)).all(),
      db.select().from(schema.partDefinitions).where(inTeam(schema.partDefinitions, teamId)).all(),
      db.select().from(schema.subsystems).where(inTeam(schema.subsystems, teamId)).all(),
      db
        .select({
          id: schema.onshapeReleases.id,
          releaseId: schema.onshapeReleases.releaseId,
          name: schema.onshapeReleases.name,
          timestamp: schema.onshapeReleases.timestamp,
          projectId: schema.onshapeReleases.projectId,
          documentId: schema.onshapeReleases.documentId,
        })
        .from(schema.onshapeReleases)
        .where(inTeam(schema.onshapeReleases, teamId))
        .all(),
      db.select().from(schema.projects).where(inTeam(schema.projects, teamId)).all(),
    ]);

    // Part numbers are matched within a project: a part's is its subsystem's, a released part's
    // its release's. A release whose project isn't known matches the part number in any project.
    const subsystemProject = new Map(allSubsystems.map((s) => [s.id, s.projectId]));
    const releaseProject = new Map(allReleases.map((r) => [r.id, r.projectId]));
    const keyOf = (project: number | null | undefined, partNumber: string) =>
      `${project ?? ""}\u0000${partNumber}`;
    const projectOfPart = (p: (typeof onshapeParts)[number]) =>
      p.releaseId === null ? null : (releaseProject.get(p.releaseId) ?? null);

    // Normalize timestamps to seconds for consistent comparison
    const toSeconds = (ts: number) => (ts > 10000000000 ? Math.floor(ts / 1000) : ts);

    // The most recent definition's createdAt (in seconds) for each part number, in its project
    // and in no particular project.
    const definitionsByNumber = new Map<string, number>();
    for (const def of definitions) {
      const defSeconds = toSeconds(def.createdAt);
      for (const key of [
        keyOf(subsystemProject.get(def.subsystemId), def.onshapePartNumber),
        keyOf(null, def.onshapePartNumber),
      ]) {
        const existing = definitionsByNumber.get(key);
        if (!existing || defSeconds > existing) definitionsByNumber.set(key, defSeconds);
      }
    }

    // Filter to parts that are either:
    // 1. Don't have a definition yet, OR
    // 2. Are newer than their definition (createdAt > definition's createdAt)
    const unfilteredPending = onshapeParts.filter((p) => {
      const partSeconds = toSeconds(p.createdAt);
      const defSeconds = definitionsByNumber.get(keyOf(projectOfPart(p), p.partNumber));
      // Keep if no definition exists, or if this part is newer than the definition
      return !defSeconds || partSeconds > defSeconds;
    });

    // Keep only the most recent version of each part (by createdAt), per project
    const partsByNumber = new Map<string, (typeof unfilteredPending)[0]>();
    for (const part of unfilteredPending) {
      const key = keyOf(projectOfPart(part), part.partNumber);
      const existing = partsByNumber.get(key);
      if (!existing || part.createdAt > existing.createdAt) {
        partsByNumber.set(key, part);
      }
    }
    const pendingParts = Array.from(partsByNumber.values());

    // Only what a new part may be filed under: not ones removed on the Admin page, or in a
    // project that was.
    const removedProjects = new Set(projects.filter((p) => p.archivedAt !== null).map((p) => p.id));
    const subsystems = allSubsystems.filter(
      (s) => s.archivedAt === null && !removedProjects.has(s.projectId),
    );

    // The releases the pending parts came from, so the page can group them by release, each
    // with its project.
    const releaseIds = new Set(pendingParts.map((p) => p.releaseId));
    const releases = allReleases.filter((r) => releaseIds.has(r.id));

    return c.json({
      parts: pendingParts,
      releases,
      subsystems,
      projects: projects.filter((p) => p.archivedAt === null),
    });
  })
  // The public demo has no Onshape: a sample release stands in for one its webhook would bring.
  .post("/parts/demo-release", requireAuth, async (c) => {
    const teamId = c.get("teamId");
    if (!isDemoTeam(teamId)) return c.json({ error: "Only in the demo." }, 403);
    return c.json(await addDemoRelease(c.env, teamId));
  })
  .post("/parts/:partNumber/:revision/fetch-drawing", requireAuth, async (c) => {
    const partNumber = c.req.param("partNumber");
    const revision = c.req.param("revision");

    if (!partNumber || !revision) {
      return c.json({ error: "Missing partNumber or revision" }, 400);
    }

    try {
      const db = createShopDb(c.env.SHOP_DB);
      const teamId = c.get("teamId");

      // The part's newest release, and the document it came from.
      const part = await latestReleasedPart(db, teamId, partNumber);

      if (!part) {
        return c.json(
          {
            error: "Part not found in OnShape data",
            detail: `No part found with number "${partNumber}"`,
          },
          404,
        );
      }

      if (!part.partDrawingEntityId) {
        return c.json(
          {
            error: "Part has no drawing available",
            detail: "This part exists but has no drawing in OnShape",
          },
          400,
        );
      }

      if (!part.versionId) {
        return c.json(
          {
            error: "Part version not available",
            detail: "Drawing metadata is missing the version ID",
          },
          400,
        );
      }

      const { credentials } = await onshapeConfig(c.env, db, teamId);
      const { documentId } = part;

      if (!documentId) {
        return c.json({ error: "The part's Onshape document isn't known" }, 400);
      }
      if (!credentials) {
        return c.json({ error: "Onshape API keys not configured" }, 400);
      }

      // Fetch the drawing
      const pdfBuffer = await exportDrawingAsPDF(
        documentId,
        part.versionId,
        part.partDrawingEntityId,
        { db, teamId, credentials },
      );

      // Store in R2 with revision in path (stamps the part-number barcode on the way in)
      await storeDrawingInR2(c.env, teamId, partNumber, revision, pdfBuffer);

      return c.json({
        success: true,
        partNumber,
        revision,
        message: "Drawing fetched and cached successfully",
      });
    } catch (err) {
      console.error("[Admin Parts] Drawing fetch error", err);
      return c.json(
        {
          error: err instanceof Error ? err.message : "Failed to fetch drawing",
        },
        500,
      );
    }
  })
  .delete("/parts/:partNumber", requireAuth, async (c) => {
    const partNumber = c.req.param("partNumber");

    if (!partNumber) {
      return c.json({ error: "Missing partNumber" }, 400);
    }

    try {
      const db = createShopDb(c.env.SHOP_DB);

      // Delete all onshapeParts with this part number
      await db
        .delete(schema.onshapeParts)
        .where(
          inTeam(
            schema.onshapeParts,
            c.get("teamId"),
            eq(schema.onshapeParts.partNumber, partNumber),
          ),
        );

      return c.json({
        success: true,
        partNumber,
        message: "Part deleted successfully",
      });
    } catch (err) {
      console.error("[Admin Parts] Delete error", err);
      return c.json(
        {
          error: err instanceof Error ? err.message : "Failed to delete part",
        },
        500,
      );
    }
  })
  /**
   * The team's Onshape connection and the documents it follows. The key, secret and webhook
   * signing keys are never sent back: only whether they're set (and whether they're still the site
   * team's worker secrets).
   */
  .get("/onshape/config", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const [config, documents] = await Promise.all([
      onshapeConfig(c.env, db, teamId),
      teamDocuments(db, teamId),
    ]);
    return c.json({
      documents: documents.map(documentJson),
      companyId: config.companyId ?? "",
      hasApiKey: config.credentials !== null,
      hasWebhookKeys: config.webhookKeys !== null,
      fromWorkerSecrets: config.fromWorkerSecrets,
      webhookUrl: eventsUrl(c.env, teamId),
    });
  })
  /**
   * Saves the team's Onshape connection (secrets left empty stay as they are), then registers
   * Shop's webhook on every document again, so each calls back on the team's own address.
   */
  .post("/onshape/config", requireAdmin, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = (key: string) =>
      typeof body[key] === "string" ? (body[key] as string).trim() : undefined;

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");

    try {
      const before = await onshapeConfig(c.env, db, teamId);
      await saveOnshapeConfig(c.env, db, teamId, {
        companyId: text("companyId"),
        apiKey: text("apiKey"),
        apiSecret: text("apiSecret"),
        webhookKeyPrimary: text("webhookKeyPrimary"),
        webhookKeySecondary: text("webhookKeySecondary"),
      });
      const config = await onshapeConfig(c.env, db, teamId);
      // Which parts changed: the company by value, the keys whenever new ones were entered (their
      // values never go in the log).
      const changed = [
        ...(text("companyId") !== undefined && (before.companyId ?? undefined) !== text("companyId")
          ? ["Onshape company"]
          : []),
        ...(text("apiKey") || text("apiSecret") ? ["Onshape API keys"] : []),
        ...(text("webhookKeyPrimary") || text("webhookKeySecondary")
          ? ["Onshape webhook signing keys"]
          : []),
      ];
      if (changed.length > 0) {
        await logTeamChange(c.env, teamId, {
          userId: c.get("userId"),
          app: "shop",
          what: "Onshape connection",
          changed,
        });
      }

      const webhooks: Record<string, WebhookOutcome> = {};
      for (const document of await teamDocuments(db, teamId)) {
        webhooks[document.documentId] = await replaceWebhook(c.env, db, teamId, config, document);
      }
      return c.json({ success: true, webhooks });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to update config" }, 500);
    }
  })
  /**
   * Follows another Onshape document: its releases go to `projectId`. Takes the document's id or
   * any address in it (and the same for the main assembly), and registers Shop's webhook on it.
   */
  .post("/onshape/documents", requireAdmin, documentValidator, async (c) => {
    const body = c.req.valid("json");
    const documentId = onshapeId(body.documentId, "documents");
    if (!documentId) return c.json({ error: "Enter the Onshape document's address or id." }, 400);
    const mainAssemblyId = onshapeId(body.mainAssemblyId, "e");

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const project = await liveProject(db, teamId, body.projectId);
    if ("error" in project) return c.json({ error: project.error }, 400);
    if (await followedDocument(db, teamId, documentId)) {
      return c.json({ error: "Shop already follows that document." }, 409);
    }

    const document = await db
      .insert(schema.onshapeDocuments)
      .values(
        withTeam(teamId, {
          documentId,
          mainAssemblyId,
          projectId: project.id,
          createdAt: Date.now(),
        }),
      )
      .returning()
      .get();
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "shop",
      what: `Added an Onshape document to ${project.name}`,
    });
    const config = await onshapeConfig(c.env, db, teamId);
    const webhook = await replaceWebhook(c.env, db, teamId, config, document);
    return c.json({ document: documentJson(document), webhook }, 201);
  })
  /** Changes a document's project or main assembly. Releases already in keep their project. */
  .patch("/onshape/documents/:id", requireAdmin, documentValidator, async (c) => {
    const body = c.req.valid("json");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const id = Number(c.req.param("id"));
    const before = await db
      .select()
      .from(schema.onshapeDocuments)
      .where(inTeam(schema.onshapeDocuments, teamId, eq(schema.onshapeDocuments.id, id)))
      .get();
    if (!before) return c.json({ error: "Shop doesn't follow that document." }, 404);

    const set: { projectId?: number; mainAssemblyId?: string | null } = {};
    const changed: string[] = [];
    if (body.projectId !== undefined) {
      const project = await liveProject(db, teamId, body.projectId);
      if ("error" in project) return c.json({ error: project.error }, 400);
      set.projectId = project.id;
      if (project.id !== before.projectId) changed.push("Project");
    }
    if (body.mainAssemblyId !== undefined) {
      set.mainAssemblyId = onshapeId(body.mainAssemblyId, "e");
      if (set.mainAssemblyId !== before.mainAssemblyId) changed.push("Main assembly");
    }
    if (Object.keys(set).length === 0) return c.json({ error: "Nothing to change." }, 400);

    const row = await db
      .update(schema.onshapeDocuments)
      .set(set)
      .where(inTeam(schema.onshapeDocuments, teamId, eq(schema.onshapeDocuments.id, id)))
      .returning()
      .get();
    if (changed.length > 0) {
      await logTeamChange(c.env, teamId, {
        userId: c.get("userId"),
        app: "shop",
        what: "An Onshape document",
        changed,
      });
    }
    return c.json(documentJson(row));
  })
  /** Stops following a document and takes Shop's webhook off it. Its releases stay. */
  .delete("/onshape/documents/:id", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const row = await db
      .delete(schema.onshapeDocuments)
      .where(
        inTeam(
          schema.onshapeDocuments,
          teamId,
          eq(schema.onshapeDocuments.id, Number(c.req.param("id"))),
        ),
      )
      .returning()
      .get();
    if (!row) return c.json({ error: "Shop doesn't follow that document." }, 404);
    const config = await onshapeConfig(c.env, db, teamId);
    if (config.credentials) {
      await unregisterOnShapeWebhooks(
        row.documentId,
        { db, teamId, credentials: config.credentials },
        eventsUrl(c.env, teamId),
      );
    }
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "shop",
      what: "Removed an Onshape document",
    });
    return c.json({ ok: true });
  })
  .get("/chat/config", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const [release, summary] = await Promise.all([
      getSetting(db, teamId, RELEASE_CHANNEL_KEY),
      getSetting(db, teamId, SUMMARY_CHANNEL_KEY),
    ]);
    return c.json({ releaseChannelId: release ?? "", summaryChannelId: summary ?? "" });
  })
  .post("/chat/config", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const body = await c.req.json<{
      releaseChannelId?: string;
      summaryChannelId?: string;
    }>();
    const release = body.releaseChannelId?.trim();
    const summary = body.summaryChannelId?.trim();

    if (!release) {
      return c.json({ error: "Choose a channel for releases." }, 400);
    }
    if (!isChannelId(release) || (summary && !isChannelId(summary))) {
      return c.json({ error: "Choose a Slack or Discord channel." }, 400);
    }

    try {
      const teamId = c.get("teamId");
      const [oldRelease, oldSummary] = await Promise.all([
        getSetting(db, teamId, RELEASE_CHANNEL_KEY),
        getSetting(db, teamId, SUMMARY_CHANNEL_KEY),
      ]);
      await setSetting(db, teamId, RELEASE_CHANNEL_KEY, release);
      if (summary) await setSetting(db, teamId, SUMMARY_CHANNEL_KEY, summary);
      const changed = [
        ...(oldRelease !== release ? ["Channel for releases"] : []),
        ...(summary && oldSummary !== summary ? ["Channel for daily summaries"] : []),
      ];
      if (changed.length > 0) {
        await logTeamChange(c.env, teamId, {
          userId: c.get("userId"),
          app: "shop",
          what: "Shop's chat channels",
          changed,
        });
      }
      return c.json({ releaseChannelId: release, summaryChannelId: summary ?? "" });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to update setting" },
        500,
      );
    }
  })
  // Posts the Overview (start of day) or Reflection (end of day) to the summary channel. The
  // browser sends the start of its local day and its time zone, since the worker runs in UTC.
  .post("/chat/daily-summary", requireAdmin, async (c) => {
    const body = await c.req.json<{
      kind?: unknown;
      since?: unknown;
      dayLabel?: unknown;
      timeZone?: unknown;
    }>();
    if (body.kind !== "overview" && body.kind !== "reflection") {
      return c.json({ error: 'kind must be "overview" or "reflection".' }, 400);
    }
    const now = Date.now();
    const since = Number(body.since);
    if (!Number.isFinite(since) || since > now || since < now - 36 * 60 * 60 * 1000) {
      return c.json({ error: "since must be the start of today (ms)." }, 400);
    }
    const dayLabel =
      typeof body.dayLabel === "string" && body.dayLabel.trim()
        ? body.dayLabel.trim().slice(0, 60)
        : new Date(since).toDateString();
    let timeZone = "UTC";
    if (typeof body.timeZone === "string") {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: body.timeZone });
        timeZone = body.timeZone;
      } catch {}
    }

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const channel = await getSetting(db, teamId, SUMMARY_CHANNEL_KEY);
    if (!channel) {
      return c.json({ error: "Choose the daily summary channel first." }, 400);
    }

    let text: string;
    if (body.kind === "overview") {
      text = formatOverview(await getOverviewStats(db, teamId), { dayLabel, now });
    } else {
      const stats = await getReflectionStats(db, teamId, since);
      const names = new Map<string, string>();
      const ids = stats.byUser.slice(0, 3).map((u) => u.userId);
      if (ids.length > 0) {
        const res = await c.env.G3ID.fetch(
          new Request(`http://g3id/api/auth/users?ids=${encodeURIComponent(ids.join(","))}`, {
            headers: { cookie: c.req.header("Cookie") ?? "" },
          }),
        );
        if (res.ok) {
          for (const u of (await res.json()) as { id: string; displayName: string }[]) {
            names.set(u.id, u.displayName);
          }
        }
      }
      text = formatReflection(stats, { dayLabel, timeZone, names });
    }

    // On the team's own chat, Slack or Discord (G3ID holds the bot's token).
    const sent = await sendTeamMessage(c.env, teamId, channel, text);
    if (!sent.ok) {
      const reason = sent.error;
      const hint =
        reason.includes("not_in_channel") || reason.includes("missing_permissions")
          ? " Give the Gearbox bot access to the channel."
          : "";
      return c.json({ error: `Couldn't post the summary: ${reason}.${hint}` }, 502);
    }
    return c.json({ text, channel });
  })
  .delete("/obsolete-instances", requireAdmin, async (c) => {
    try {
      const db = createShopDb(c.env.SHOP_DB);
      const teamId = c.get("teamId");

      // First, get all stale instance IDs
      const staleInstances = await db
        .select({ id: schema.partInstances.id })
        .from(schema.partInstances)
        .where(inTeam(schema.partInstances, teamId, eq(schema.partInstances.isStale, 1)));

      const staleInstanceIds = staleInstances.map((i) => i.id);

      if (staleInstanceIds.length === 0) {
        return c.json({
          success: true,
          message: "No obsolete instances to delete",
        });
      }

      // A file made for one of them stays obsolete after they're gone (lib/batches.ts).
      const theirFiles = [...(await obsoleteFileIds(db, teamId))];
      for (let i = 0; i < theirFiles.length; i += 80) {
        await db
          .update(schema.files)
          .set({ obsoletedAt: Date.now() })
          .where(
            inTeam(
              schema.files,
              teamId,
              inArray(schema.files.id, theirFiles.slice(i, i + 80)),
              isNull(schema.files.obsoletedAt),
            ),
          );
      }

      // D1 caps a statement at 100 bound parameters.
      const batchSize = 80;

      // Delete associated actions (actions table has FK to part_instances)
      for (let i = 0; i < staleInstanceIds.length; i += batchSize) {
        const batch = staleInstanceIds.slice(i, i + batchSize);
        await db
          .delete(schema.actions)
          .where(inTeam(schema.actions, teamId, inArray(schema.actions.partInstanceId, batch)));
      }

      // Delete associated processes (part_instance_processes has FK to part_instances)
      for (let i = 0; i < staleInstanceIds.length; i += batchSize) {
        const batch = staleInstanceIds.slice(i, i + batchSize);
        await db
          .delete(schema.partInstanceProcesses)
          .where(
            inTeam(
              schema.partInstanceProcesses,
              teamId,
              inArray(schema.partInstanceProcesses.partInstanceId, batch),
            ),
          );
      }

      // Finally delete the stale instances
      await db
        .delete(schema.partInstances)
        .where(inTeam(schema.partInstances, teamId, eq(schema.partInstances.isStale, 1)));

      return c.json({
        success: true,
        message: `Deleted ${staleInstanceIds.length} obsolete instances`,
      });
    } catch (err) {
      console.error("[Delete Obsolete Instances Error]", err);
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to delete obsolete instances" },
        500,
      );
    }
  });
