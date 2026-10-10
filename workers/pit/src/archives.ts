import { inTeam, requireAuth, withTeam } from "@g3/auth";
import { desc, eq, inArray, lt } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type Db, createDb } from "./db";
import { checklistArchives, checklistIssues, checklistItems, checklistLists } from "./db/schema";
import { getSetting, teamNumberOf } from "./settings";
import type { AppEnv } from "./types";

// Checklist archives: "Archive and Reset" saves the checklists as they stand (what's checked,
// which issues are open and which were resolved since the archive before), then unchecks
// everything. Open issues are left alone. The Logs page reads the archives back.

export const ARCHIVE_TYPES = ["match", "practice", "other"] as const;
export type ArchiveType = (typeof ARCHIVE_TYPES)[number];

/**
 * How an issue stood when the checklists were archived: "new" was reported since the archive
 * before and is open, "open" was already open at the archive before and still is, "resolved" was
 * resolved since the archive before, whether it was reported before that archive or after it.
 */
export type ArchivedIssueStatus = "new" | "open" | "resolved";

export type ArchivedIssue = {
  id: number;
  text: string;
  createdAt: number;
  status: ArchivedIssueStatus;
};
export type ArchivedItem = {
  id: number;
  type: "item" | "topic";
  name: string;
  description: string | null;
  checked: boolean;
  issues: ArchivedIssue[];
};
export type ArchivedList = {
  id: number;
  name: string;
  description: string | null;
  items: ArchivedItem[];
};
export type ArchiveSnapshot = { lists: ArchivedList[] };

const EVENT_MAX = 60;
const DETAILS_MAX = 120;
/** How many archives the Logs page gets at a time. */
const PAGE_SIZE = 50;

function parseId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseSnapshot(raw: string): ArchiveSnapshot {
  try {
    const value = JSON.parse(raw) as ArchiveSnapshot;
    return Array.isArray(value?.lists) ? value : { lists: [] };
  } catch {
    return { lists: [] };
  }
}

/** The event the team is at: its Blue Alliance key, else its Nexus key, else "". */
async function currentEvent(db: Db, team: string) {
  const [eventKey, nexusEventKey] = await Promise.all([
    getSetting(db, team, "eventKey"),
    getSetting(db, team, "nexusEventKey"),
  ]);
  return { eventKey, nexusEventKey, event: eventKey || nexusEventKey };
}

/**
 * The checklists as they stand, with each issue's status against the archive before
 * (`previous`, null for a team's first archive, where every open issue is new), and the ids of
 * the resolved issues in it, which this archive is the record of.
 */
async function buildSnapshot(
  db: Db,
  team: string,
  previous: ArchiveSnapshot | null,
): Promise<{ snapshot: ArchiveSnapshot; resolvedIds: number[] }> {
  const [lists, items, issues] = await Promise.all([
    db.select().from(checklistLists).where(inTeam(checklistLists, team)).orderBy(checklistLists.id),
    db
      .select()
      .from(checklistItems)
      .where(inTeam(checklistItems, team))
      .orderBy(checklistItems.index, checklistItems.id),
    db
      .select()
      .from(checklistIssues)
      .where(inTeam(checklistIssues, team))
      .orderBy(checklistIssues.createdAt, checklistIssues.id),
  ]);

  // The issues that were open at the archive before: one still open is "still open", not new.
  const openBefore = new Set<number>();
  for (const list of previous?.lists ?? []) {
    for (const item of list.items) {
      for (const issue of item.issues) if (issue.status !== "resolved") openBefore.add(issue.id);
    }
  }

  // A resolved issue is still a row until an archive has recorded it; one whose item was deleted
  // went with the item.
  const issuesOf = (itemId: number): ArchivedIssue[] =>
    issues
      .filter((issue) => issue.itemId === itemId)
      .map((issue) => ({
        id: issue.id,
        text: issue.text,
        createdAt: issue.createdAt,
        status: issue.resolvedAt !== null ? "resolved" : openBefore.has(issue.id) ? "open" : "new",
      }));

  const snapshot: ArchiveSnapshot = {
    lists: lists.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      items: items
        .filter((item) => item.listId === list.id)
        .map((item) => ({
          id: item.id,
          type: item.type,
          name: item.name,
          description: item.description,
          checked: item.checked,
          issues: issuesOf(item.id),
        })),
    })),
  };
  return {
    snapshot,
    resolvedIds: issues.filter((issue) => issue.resolvedAt !== null).map((issue) => issue.id),
  };
}

/** `items` in groups small enough for one statement's bound values (D1 allows 100). */
function chunks<T>(items: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * A Blue Alliance match key as a short name: "2026gadal_qm42" → "Qual 42", "…_sf5m1" →
 * "Playoff 5", "…_f1m2" → "Final 2". "" for anything else.
 */
export function tbaMatchLabel(key: unknown): string {
  if (typeof key !== "string") return "";
  const match = key.slice(key.lastIndexOf("_") + 1).match(/^(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/);
  if (!match) return "";
  const [, level, first, second] = match;
  if (level === "qm") return `Qual ${first}`;
  // Finals are one set of several matches; a playoff round is a set of one.
  if (level === "f") return `Final ${second ?? first}`;
  const name = level === "sf" ? "Playoff" : level === "qf" ? "Quarterfinal" : "Eighthfinal";
  return second && second !== "1" ? `${name} ${first}-${second}` : `${name} ${first}`;
}

/**
 * The team's next official match in a Nexus schedule: its first match that hasn't gone on the
 * field, practice matches left out. "" when there isn't one.
 */
export function nexusNextMatch(matches: unknown, teamNumber: string): string {
  if (!Array.isArray(matches)) return "";
  for (const raw of matches) {
    const match = raw as {
      label?: unknown;
      status?: unknown;
      redTeams?: unknown;
      blueTeams?: unknown;
    };
    if (typeof match?.label !== "string" || /^practice/i.test(match.label)) continue;
    if (match.status === "On field") continue;
    const teams = [match.redTeams, match.blueTeams].flatMap((side) =>
      Array.isArray(side) ? side.map(String) : [],
    );
    if (teams.includes(teamNumber)) return match.label.replace(/^Qualification\b/, "Qual");
  }
  return "";
}

/** A JSON answer from a schedule service, or null when it fails or takes too long. */
async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * The team's next official match at its event, from The Blue Alliance, else Nexus. "" when
 * neither can say (no key, no schedule yet, or the team has no more matches).
 */
async function nextOfficialMatch(
  env: AppEnv["Bindings"],
  teamNumber: string,
  eventKey: string,
  nexusEventKey: string,
): Promise<string> {
  if (eventKey && env.TBA_AUTH_KEY) {
    const status = (await fetchJson(
      `https://www.thebluealliance.com/api/v3/team/frc${teamNumber}/event/${encodeURIComponent(eventKey)}/status`,
      { "X-TBA-Auth-Key": env.TBA_AUTH_KEY },
    )) as { next_match_key?: unknown } | null;
    const label = tbaMatchLabel(status?.next_match_key);
    if (label) return label;
  }
  if (nexusEventKey && env.NEXUS_API_KEY) {
    const data = (await fetchJson(
      `https://frc.nexus/api/v1/event/${encodeURIComponent(nexusEventKey)}`,
      { "Nexus-Api-Key": env.NEXUS_API_KEY },
    )) as { matches?: unknown } | null;
    return nexusNextMatch(data?.matches, teamNumber);
  }
  return "";
}

const archiveValidator = validator("json", (value, c) => {
  const v = (value ?? {}) as { event?: unknown; type?: unknown; details?: unknown };
  if (!ARCHIVE_TYPES.includes(v.type as ArchiveType))
    return c.json({ error: "type must be match, practice or other." }, 400);
  if (v.event !== undefined && typeof v.event !== "string")
    return c.json({ error: "event must be a string." }, 400);
  if (v.details !== undefined && typeof v.details !== "string")
    return c.json({ error: "details must be a string." }, 400);
  const event = (v.event ?? "").trim();
  const details = (v.details ?? "").trim();
  if (event.length > EVENT_MAX)
    return c.json({ error: `The event can be ${EVENT_MAX} characters at most.` }, 400);
  if (details.length > DETAILS_MAX)
    return c.json({ error: `The details can be ${DETAILS_MAX} characters at most.` }, 400);
  return { type: v.type as ArchiveType, event, details };
});

const pageValidator = validator("query", (value) => {
  const before = Array.isArray(value.before) ? value.before[0] : value.before;
  return { before: before as string | undefined };
});

/** What the Logs page lists: an archive without its snapshot. */
const header = {
  id: checklistArchives.id,
  event: checklistArchives.event,
  type: checklistArchives.type,
  details: checklistArchives.details,
  archivedAt: checklistArchives.archivedAt,
  archivedByName: checklistArchives.archivedByName,
};

export const archiveRoutes = new Hono<AppEnv>()
  // What the Archive pop-up starts with: the event the team is at, from its settings ("" when it
  // has none).
  .get("/defaults", requireAuth, async (c) => {
    const { event } = await currentEvent(createDb(c.env.PIT_DB), c.get("teamId"));
    return c.json({ event });
  })

  // The team's next official match at that event ("" when there's no event or nobody can say).
  // Asks The Blue Alliance or Nexus, so the pop-up calls it only when it opens.
  .get("/next-match", requireAuth, async (c) => {
    const team = c.get("teamId");
    const { eventKey, nexusEventKey, event } = await currentEvent(createDb(c.env.PIT_DB), team);
    const nextMatch = event
      ? await nextOfficialMatch(c.env, teamNumberOf(team), eventKey, nexusEventKey)
      : "";
    return c.json({ nextMatch });
  })

  // Newest first, a page at a time: `before` is the last id of the page before.
  .get("/", requireAuth, pageValidator, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const team = c.get("teamId");
    const before = parseId(c.req.valid("query").before);
    const rows = await db
      .select(header)
      .from(checklistArchives)
      .where(inTeam(checklistArchives, team, before ? lt(checklistArchives.id, before) : undefined))
      .orderBy(desc(checklistArchives.id))
      .limit(PAGE_SIZE + 1);
    return c.json({ archives: rows.slice(0, PAGE_SIZE), more: rows.length > PAGE_SIZE });
  })

  .get("/:id", requireAuth, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const db = createDb(c.env.PIT_DB);
    const [row] = await db
      .select({ ...header, snapshot: checklistArchives.snapshot })
      .from(checklistArchives)
      .where(inTeam(checklistArchives, c.get("teamId"), eq(checklistArchives.id, id)));
    if (!row) return c.json({ error: "Archive not found." }, 404);
    return c.json({ ...row, snapshot: parseSnapshot(row.snapshot) });
  })

  // Archive and reset: saves the checklists as they stand, then unchecks every item. Open issues
  // stay as they are; the resolved ones it recorded are deleted, so each is said once.
  .post("/", requireAuth, archiveValidator, async (c) => {
    const body = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const team = c.get("teamId");
    // At an event (a key in the team's settings) the archive is for that event, whatever was sent.
    const event = (await currentEvent(db, team)).event || body.event;
    const [last] = await db
      .select({ snapshot: checklistArchives.snapshot })
      .from(checklistArchives)
      .where(inTeam(checklistArchives, team))
      .orderBy(desc(checklistArchives.id))
      .limit(1);
    const { snapshot, resolvedIds } = await buildSnapshot(
      db,
      team,
      last ? parseSnapshot(last.snapshot) : null,
    );
    // One batch: the checks are only cleared, and the resolved issues only deleted, if the archive
    // was saved. Only the issues in this archive go: one resolved a moment later waits for the next.
    const [created] = await db.batch([
      db
        .insert(checklistArchives)
        .values(
          withTeam(team, {
            event,
            type: body.type,
            details: body.details,
            archivedAt: Math.floor(Date.now() / 1000),
            archivedBy: c.get("userId"),
            archivedByName: c.get("userDisplayName"),
            snapshot: JSON.stringify(snapshot),
          }),
        )
        .returning(header),
      db.update(checklistItems).set({ checked: false }).where(inTeam(checklistItems, team)),
      ...chunks(resolvedIds).map((ids) =>
        db
          .delete(checklistIssues)
          .where(inTeam(checklistIssues, team, inArray(checklistIssues.id, ids))),
      ),
    ]);
    return c.json(created[0], 201);
  });
