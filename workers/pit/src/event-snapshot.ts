import { inTeam, logTeamChange, requireAdmin, withTeam } from "@g3/auth";
import { isStaging } from "@g3/site-config";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type Db, createDb } from "./db";
import { settings } from "./db/schema";
import { type MatchResult, contextRankingsFor } from "./monitor-matches";
import { getSetting } from "./settings";
import gritsSnapshot from "./snapshots/2026gagr.json";
import type { AppEnv } from "./types";

// A past event for the Monitor, in dev and staging only: GRITS 2026 (2026gagr) as Qualification
// 31 went on the field, halfway through qualifications, so the Monitor has a schedule, results,
// queuing and rankings to show away from an event. An admin switches it on on Pit's Admin page
// ("Use event snapshot"); off, the Monitor asks The Blue Alliance and Nexus as usual. Production
// never offers it.
//
// The snapshot's times are kept from the moment it was taken and replayed from when it was
// switched on (the setting's value), so the countdowns run as they did; switching it off and on
// starts them again. The data comes from The Blue Alliance's public pages for the event.

type Bindings = AppEnv["Bindings"];

type SnapshotMatch = {
  label: string;
  status: "Queuing soon" | "Now queuing" | "On deck" | "On field";
  redTeams: string[];
  blueTeams: string[];
  /** When it was to start, in ms from the moment the snapshot was taken. */
  startOffsetMs: number;
  result?: { red: number; blue: number; winner: string };
};

type Snapshot = {
  event: string;
  name: string;
  /** The team whose matches the Monitor follows. */
  teamNumber: string;
  source: string;
  matches: SnapshotMatch[];
  rankings: {
    rank: number;
    team: string;
    rp: number;
    wins: number;
    losses: number;
    ties: number;
  }[];
};

const snapshot = gritsSnapshot as Snapshot;

const SINCE = "eventSnapshotSince";

/** Nexus's estimates, before a match starts: queuing and going on the field. */
const QUEUE_BEFORE_MS = 18 * 60_000;
const ON_FIELD_BEFORE_MS = 5 * 60_000;

/** Dev (a local gateway) and staging; never production. */
export const snapshotAvailable = (env: Pick<Bindings, "LOCAL_GATEWAY_URL">) =>
  isStaging || Boolean(env.LOCAL_GATEWAY_URL);

/** When the team switched the snapshot on (ms), or null while it's off or not offered. */
async function snapshotSince(env: Bindings, db: Db, team: string): Promise<number | null> {
  if (!snapshotAvailable(env)) return null;
  const value = Number(await getSetting(db, team, SINCE));
  return value > 0 ? value : null;
}

/** What `GET /monitor/data` answers from the snapshot, or null to ask the services as usual. */
export async function snapshotMonitorData(env: Bindings, db: Db, team: string) {
  const since = await snapshotSince(env, db, team);
  if (since === null) return null;
  const ours = snapshot.rankings.find((r) => r.team === snapshot.teamNumber);
  return {
    teamNumber: snapshot.teamNumber,
    nexus: {
      isRealNexus: true,
      matches: snapshot.matches.map((match) => {
        const start = since + match.startOffsetMs;
        return {
          label: match.label,
          status: match.status,
          redTeams: match.redTeams,
          blueTeams: match.blueTeams,
          times: {
            estimatedQueueTime: start - QUEUE_BEFORE_MS,
            estimatedOnFieldTime: start - ON_FIELD_BEFORE_MS,
            estimatedStartTime: start,
          },
          result: (match.result as MatchResult | undefined) ?? null,
        };
      }),
    },
    ranking: ours
      ? {
          rank: ours.rank,
          wins: ours.wins,
          losses: ours.losses,
          ties: ours.ties,
          rp: ours.rp,
          epa: 0,
        }
      : null,
    contextRankings: ours ? contextRankingsFor(snapshot.rankings, ours.rank) : null,
    snapshot: { event: snapshot.event, name: snapshot.name },
  };
}

const onValidator = validator("json", (value, c) => {
  const v = value as { on?: unknown };
  if (typeof v?.on !== "boolean") return c.json({ error: "on must be a boolean." }, 400);
  return { on: v.on };
});

export const eventSnapshotRoutes = new Hono<AppEnv>()
  // Whether it's offered here and on, for Pit's Admin page.
  .get("/", requireAdmin, async (c) => {
    const available = snapshotAvailable(c.env);
    const since = await snapshotSince(c.env, createDb(c.env.PIT_DB), c.get("teamId"));
    return c.json({ available, on: since !== null, name: available ? snapshot.name : null });
  })
  .put("/", requireAdmin, onValidator, async (c) => {
    if (!snapshotAvailable(c.env)) return c.json({ error: "Not offered here." }, 404);
    const { on } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const team = c.get("teamId");
    const value = on ? String(Date.now()) : "";
    if (on) {
      await db
        .insert(settings)
        .values(withTeam(team, { key: SINCE, value }))
        .onConflictDoUpdate({ target: [settings.teamId, settings.key], set: { value } });
    } else {
      await db.delete(settings).where(inTeam(settings, team, eq(settings.key, SINCE)));
    }
    await logTeamChange(c.env, team, {
      userId: c.get("userId"),
      app: "pit",
      what: "Pit settings",
      changed: ["Use event snapshot"],
    });
    return c.json({ on });
  });
