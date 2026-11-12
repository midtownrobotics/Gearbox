// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Program,
  demoTeamId,
  parseTeamId,
  teamAppUrlVia,
  teamIdFor,
  teamKey,
  teamLabel,
} from "@g3/site-config";
import { and, eq, isNull, lt } from "drizzle-orm";
import { teamMoves, teams } from "./db/schema";
import { db, g3id, now, tellAdmins } from "./lib";
import { BINDINGS, MANIFESTS } from "./registry";
import type { AppEnv } from "./types";

// Moving a team to another id (migration 0019): a team's id is its program and number, so a team
// that changes program changes id. Every team from before FTC teams could sign up is "frc<number>";
// one whose admin says it's in FTC moves to "ftc<number>", and an operator can change a team's
// program either way.
//
// While a move runs (`team_moves.finished_at` null) the gateway answers the team's addresses with
// a short "moving" page (GET /teams/:id says `moving`), so nothing is written under the old id
// halfway through. It moves the team's data in every app that keeps some (each manifest's `move`
// hook, called until it says it's done: files go a few hundred at a time), then in G3ID, then the
// platform's own rows, last, since the team's registry row says where the team is. Each step is
// safe to run again, so a move that stops partway (an app down, the request cut off) is tried
// again by the hourly cron (retryMoves). Once it's done, the old id's addresses send pages to the
// new ones and pass API calls on to the team (GET /teams/<old id> says `movedTo`), until another
// team signs up with the old id.

type Env = AppEnv["Bindings"];

/** How many times an app's move is called in one run before leaving the rest for the next. */
const MAX_CALLS_PER_APP = 50;

/** A run that started this recently is still going: the cron leaves it alone. */
const RUNNING_S = 10 * 60;

/** The team id a team with this id would have in `program`. */
export function idInProgram(teamId: string, program: Program): string | null {
  const team = parseTeamId(teamId);
  return team ? teamIdFor(program, team.number) : null;
}

/** The site's team and the demo stay where they are: their ids are in site.ts. */
export const canMove = (teamId: string) => teamId !== teamKey && teamId !== demoTeamId;

/** An unfinished move from this team id, if any. */
export async function unfinishedMove(env: Env, teamId: string) {
  return db(env)
    .select()
    .from(teamMoves)
    .where(and(eq(teamMoves.fromId, teamId), isNull(teamMoves.finishedAt)))
    .get();
}

/**
 * Where a team id that's no team now went: a finished move from it. Null for an id a team has (a
 * team that signed up with it since) or that never moved.
 */
export async function movedTo(env: Env, teamId: string): Promise<string | null> {
  const move = await db(env).select().from(teamMoves).where(eq(teamMoves.fromId, teamId)).get();
  if (!move?.finishedAt) return null;
  const team = await db(env)
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, move.toId), eq(teams.status, "active")))
    .get();
  return team ? move.toId : null;
}

/**
 * Starts moving a team to another id and runs it (see above). Refused (a reason) when the new id is
 * taken; a sign-up for it that never finished is given up. Gives back null once it's started.
 */
export async function startMove(
  env: Env,
  from: string,
  to: string,
  requestedBy: string | null,
): Promise<string | null> {
  if (!canMove(from)) return "This team's program can't change.";
  const database = db(env);
  const taken = await database.select().from(teams).where(eq(teams.id, to)).get();
  if (taken && taken.status !== "pending") {
    return `${teamLabel(to)} is already on Gearbox. Report it if it isn't your team.`;
  }
  if (taken) await database.delete(teams).where(eq(teams.id, to));
  await database.batch([
    // The new id is the team's now: nothing redirects from it any more.
    database
      .delete(teamMoves)
      .where(eq(teamMoves.fromId, to)),
    database
      .insert(teamMoves)
      .values({ fromId: from, toId: to, requestedBy, startedAt: now() })
      .onConflictDoUpdate({
        target: teamMoves.fromId,
        set: {
          toId: to,
          requestedBy,
          startedAt: now(),
          finishedAt: null,
          attempts: 0,
          lastError: null,
        },
      }),
  ]);
  return null;
}

/** One app's move hook, called until it's done. Throws when it fails or doesn't finish. */
async function moveApp(env: Env, app: keyof typeof BINDINGS, from: string, to: string) {
  const binding = BINDINGS[app];
  if (!binding || !MANIFESTS[app].hooks.move) return;
  for (let i = 0; i < MAX_CALLS_PER_APP; i++) {
    const res = await (env[binding] as Fetcher).fetch(
      new Request(`http://${app}/api/internal/teams/${encodeURIComponent(from)}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      }),
    );
    if (!res.ok) throw new Error(`${MANIFESTS[app].name}: ${res.status} ${await res.text()}`);
    const { done } = (await res.json()) as { done?: boolean };
    if (done) return;
  }
  throw new Error(`${MANIFESTS[app].name}: not finished yet`);
}

/**
 * The platform's own rows, last (?1 → ?2): the team's registry row under the new id, every row
 * that points at it, then the old row, and the move marked done, all in one batch.
 */
const MOVE_PLATFORM_ROWS = [
  "PRAGMA defer_foreign_keys = on",
  `INSERT INTO teams (id, program, team_number, program_chosen_at, name, country, status,
     founder_user_id, owner_user_id, slack_workspace_id, slack_workspace_name, discord_guild_id,
     discord_guild_name, terms_accepted_at, terms_version, signup_id, signup_code_token,
     created_at, updated_at)
   SELECT ?2, substr(?2, 1, 3), team_number, unixepoch(), name, country, status, founder_user_id,
     owner_user_id, slack_workspace_id, slack_workspace_name, discord_guild_id, discord_guild_name,
     terms_accepted_at, terms_version, NULL, NULL, created_at, unixepoch()
   FROM teams WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM teams WHERE id = ?2)`,
  "UPDATE team_apps SET team_id = ?2 WHERE team_id = ?1",
  "UPDATE team_audit_log SET team_id = ?2 WHERE team_id = ?1",
  "UPDATE notifications SET team_id = ?2 WHERE team_id = ?1",
  "UPDATE team_notification_settings SET team_id = ?2 WHERE team_id = ?1",
  "UPDATE operator_actions SET team_id = ?2 WHERE team_id = ?1",
  "UPDATE problem_reports SET team_id = ?2 WHERE team_id = ?1",
  "UPDATE reporters SET team_id = ?2 WHERE team_id = ?1",
  "DELETE FROM teams WHERE id = ?1",
  "UPDATE team_moves SET finished_at = unixepoch(), last_error = NULL WHERE from_id = ?1",
];

/** The values a statement of a move uses (?1, ?2): D1 refuses any others. */
export const usedBinds = (sql: string, from: string, to: string) =>
  sql.includes("?2") ? [from, to] : sql.includes("?1") ? [from] : [];

/**
 * Runs a team's unfinished move to the end: true once it's done. When a step fails, the move stays
 * unfinished (the team's addresses keep saying it's moving) with what went wrong, for the cron
 * to try again.
 */
export async function runMove(env: Env, from: string): Promise<boolean> {
  const move = await unfinishedMove(env, from);
  if (!move) return true;
  const { toId: to } = move;
  await db(env)
    .update(teamMoves)
    .set({ attempts: move.attempts + 1, startedAt: now() })
    .where(eq(teamMoves.fromId, from));
  try {
    for (const app of Object.keys(BINDINGS) as (keyof typeof BINDINGS)[]) {
      await moveApp(env, app, from, to);
    }
    const res = await g3id(env, `/teams/${encodeURIComponent(from)}/move`, {
      method: "POST",
      body: { to },
    });
    if (!res.ok) throw new Error(`ID: ${res.status} ${await res.text()}`);
    await env.PLATFORM_DB.batch(
      MOVE_PLATFORM_ROWS.map((sql) =>
        env.PLATFORM_DB.prepare(sql).bind(...usedBinds(sql, from, to)),
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[moves] ${from} → ${to}`, message);
    await db(env)
      .update(teamMoves)
      .set({ lastError: message.slice(0, 500) })
      .where(eq(teamMoves.fromId, from));
    return false;
  }
  const home = `${teamAppUrlVia(env.LOCAL_GATEWAY_URL || undefined, to, "portal")}/`;
  await tellAdmins(
    env,
    to,
    `${teamLabel(to)}'s Gearbox has a new address: ${home} Links to the old one keep working for now, but update your bookmarks.`,
  );
  return true;
}

/** The hourly cron: tries again every move that stopped partway (and isn't running now). */
export async function retryMoves(env: Env) {
  const stuck = await db(env)
    .select({ fromId: teamMoves.fromId })
    .from(teamMoves)
    .where(and(isNull(teamMoves.finishedAt), lt(teamMoves.startedAt, now() - RUNNING_S)))
    .all();
  for (const { fromId } of stuck) await runMove(env, fromId);
}
