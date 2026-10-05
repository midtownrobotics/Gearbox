import { requireAuth } from "@g3/auth";
import { CONSOLE_HOSTS, teamKey } from "@g3/site-config";
import { and, count, desc, eq, inArray, like, lt } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
  type OPERATOR_ACTIONS,
  numberReports,
  operatorActions,
  operators,
  teams,
} from "./db/schema";
import { db, g3id, now } from "./lib";
import type { AppEnv } from "./types";

// The platform operators' console (roadmap 2.8), at /console on the platform worker; its page is
// apps/platform's /console, opened at admin.<domain> (CONSOLE_HOSTS). Operators are G3ID accounts
// flagged in this worker's `operators` table, never by a team role. They:
// - delete a team: its registry row here, and in G3ID every account, session, kiosk and its Slack;
// - renumber a team (its id is "frc<number>", so every row pointing at it moves too);
// - hand a team to another of its members, who becomes an admin;
// - suspend a team (the gateway stops answering its addresses) and reactivate it;
// - follow up reports that a number was falsely registered (POST /reports);
// - add and remove other operators.
// Every action is logged in `operator_actions` with the operator's reason, and so is each look at a
// team's members (the privacy policy's operator access log, kept 12 months). The site's own team
// (site.ts) can't be deleted, renumbered or suspended: its apps' data isn't per team yet.
//
// Other apps' data isn't per team until Phase 3; when it is, deleting and renumbering a team must
// reach it too (each app's "delete a team's data" hook).

type Member = {
  id: string;
  displayName: string;
  email: string;
  status: string;
  isAdmin: boolean;
  isMentor: boolean;
  lastLoginAt: number | null;
};

type Account = { id: string; displayName: string; email: string; teamId: string };

/** G3ID accounts by id (any team). */
async function accounts(env: AppEnv["Bindings"], ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map<string, Account>();
  const res = await g3id(env, `/users?ids=${wanted.map(encodeURIComponent).join(",")}`);
  if (!res.ok) throw new Error(`G3ID /users: ${res.status}`);
  const list = (await res.json()) as Account[];
  return new Map(list.map((a) => [a.id, a]));
}

/** A page of the console: its own address, or a local dev server. */
function fromConsole(origin: string | undefined): boolean {
  if (!origin) return false;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return CONSOLE_HOSTS.some((host) => origin === `https://${host}`);
}

/**
 * Operators only. Changes must come from the console's own pages: every team's pages share the
 * session cookie's domain, so another page there could otherwise send one with an operator's
 * cookie.
 */
const requireOperator = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method !== "GET" && !fromConsole(c.req.header("Origin"))) {
    return c.json({ error: "Changes are only made from the console." }, 403);
  }
  if (c.get("sessionType") === "pin") return c.json({ error: "Not allowed from a kiosk." }, 403);
  const operator = await db(c.env)
    .select({ userId: operators.userId })
    .from(operators)
    .where(eq(operators.userId, c.get("userId")))
    .get();
  if (!operator) return c.json({ error: "Platform operators only." }, 403);
  await next();
});

type Action = (typeof OPERATOR_ACTIONS)[number];

/** How long the log is kept (the privacy policy's "Operator access log"). */
const LOG_KEPT_S = 365 * 24 * 60 * 60;

/** A team's details opened again by the same operator within this long isn't logged again. */
const VIEW_LOGGED_EVERY_S = 60 * 60;

/** Logs an action, and drops rows older than the log is kept. */
async function log(
  env: AppEnv["Bindings"],
  operatorUserId: string,
  action: Action,
  entry: { teamId?: string | null; reason?: string | null; details?: Record<string, unknown> },
) {
  await db(env).batch([
    db(env)
      .insert(operatorActions)
      .values({
        id: crypto.randomUUID(),
        operatorUserId,
        action,
        teamId: entry.teamId ?? null,
        reason: entry.reason ?? null,
        details: JSON.stringify(entry.details ?? {}),
        createdAt: now(),
      }),
    db(env)
      .delete(operatorActions)
      .where(lt(operatorActions.createdAt, now() - LOG_KEPT_S)),
  ]);
}

/** The operator's reason, required for anything done to a team. */
function reasonOf(body: { reason?: unknown }): string | null {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  return reason && reason.length <= 500 ? reason : null;
}

const NO_REASON = "Say why (up to 500 characters). It's kept in the log.";

function teamById(env: AppEnv["Bindings"], id: string) {
  return db(env).select().from(teams).where(eq(teams.id, id)).get();
}

/** G3ID's error message, if it sent one. */
async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

const validNumber = (n: number) => Number.isInteger(n) && n >= 1 && n <= 99999;

export const consoleRouter = new Hono<AppEnv>()
  // Who's signed in, and whether they're an operator: the console's sign-in check. Comes before
  // the operators-only middleware below, which it never reaches (it answers without next()).
  .get("/me", requireAuth, async (c) => {
    const operator = await db(c.env)
      .select({ userId: operators.userId })
      .from(operators)
      .where(eq(operators.userId, c.get("userId")))
      .get();
    return c.json({
      user: {
        id: c.get("userId"),
        displayName: c.get("userDisplayName"),
        email: c.get("userEmail"),
      },
      isOperator: !!operator && c.get("sessionType") !== "pin",
    });
  })
  .use("*", requireAuth, requireOperator)
  .get("/teams", async (c) => {
    const status = c.req.query("status");
    const q = (c.req.query("q") ?? "").trim();
    const filters = [];
    if (status === "pending" || status === "active" || status === "suspended") {
      filters.push(eq(teams.status, status));
    }
    if (q) {
      filters.push(/^\d+$/.test(q) ? eq(teams.teamNumber, Number(q)) : like(teams.name, `%${q}%`));
    }
    const [list, reports] = await Promise.all([
      db(c.env)
        .select({
          id: teams.id,
          teamNumber: teams.teamNumber,
          name: teams.name,
          country: teams.country,
          status: teams.status,
          slackWorkspaceName: teams.slackWorkspaceName,
          createdAt: teams.createdAt,
        })
        .from(teams)
        .where(and(...filters))
        .orderBy(teams.teamNumber)
        .limit(500)
        .all(),
      db(c.env)
        .select({ teamNumber: numberReports.teamNumber, open: count() })
        .from(numberReports)
        .where(eq(numberReports.status, "open"))
        .groupBy(numberReports.teamNumber)
        .all(),
    ]);
    const open = new Map(reports.map((r) => [r.teamNumber, r.open]));
    return c.json(
      list.map((t) => ({
        ...t,
        openReports: open.get(t.teamNumber) ?? 0,
        isSite: t.id === teamKey,
      })),
    );
  })
  .get("/teams/:id", async (c) => {
    const team = await teamById(c.env, c.req.param("id"));
    if (!team) return c.json({ error: "No such team." }, 404);
    const [membersRes, reports, actions] = await Promise.all([
      g3id(c.env, `/teams/${team.id}/members`),
      db(c.env)
        .select()
        .from(numberReports)
        .where(eq(numberReports.teamNumber, team.teamNumber))
        .orderBy(desc(numberReports.createdAt))
        .all(),
      db(c.env)
        .select()
        .from(operatorActions)
        .where(eq(operatorActions.teamId, team.id))
        .orderBy(desc(operatorActions.createdAt))
        .all(),
    ]);
    if (!membersRes.ok) throw new Error(`G3ID members: ${membersRes.status}`);
    const members = (await membersRes.json()) as Member[];
    // Opening a team shows its members' names and emails: an access the log records.
    const seen = actions.some(
      (a) =>
        a.action === "view_team" &&
        a.operatorUserId === c.get("userId") &&
        a.createdAt > now() - VIEW_LOGGED_EVERY_S,
    );
    if (!seen) await log(c.env, c.get("userId"), "view_team", { teamId: team.id });
    const names = await accounts(
      c.env,
      [team.founderUserId, ...actions.map((a) => a.operatorUserId)].filter(
        (id) => !members.some((m) => m.id === id),
      ),
    );
    const name = (id: string | null) =>
      id
        ? (members.find((m) => m.id === id)?.displayName ?? names.get(id)?.displayName ?? id)
        : null;
    return c.json({
      team: {
        id: team.id,
        teamNumber: team.teamNumber,
        name: team.name,
        country: team.country,
        timeZone: team.timeZone,
        status: team.status,
        slackWorkspaceName: team.slackWorkspaceName,
        founder: team.founderUserId && { id: team.founderUserId, name: name(team.founderUserId) },
        owner: team.ownerUserId && { id: team.ownerUserId, name: name(team.ownerUserId) },
        termsAcceptedAt: team.termsAcceptedAt,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
        isSite: team.id === teamKey,
      },
      members,
      reports,
      actions: actions.map((a) => ({
        ...a,
        details: JSON.parse(a.details) as Record<string, unknown>,
        operatorName: name(a.operatorUserId),
      })),
    });
  })
  // Deleting a team: everything G3ID has for it, then its registry row, which frees its number.
  // The operator types the team's number to confirm.
  .delete("/teams/:id", async (c) => {
    const body = await c.req.json<{ reason?: unknown; confirmNumber?: unknown }>();
    const reason = reasonOf(body);
    if (!reason) return c.json({ error: NO_REASON }, 400);
    const team = await teamById(c.env, c.req.param("id"));
    if (!team) return c.json({ error: "No such team." }, 404);
    if (team.id === teamKey) return c.json({ error: "The site's own team can't be deleted." }, 409);
    if (Number(body.confirmNumber) !== team.teamNumber) {
      return c.json({ error: `Type ${team.teamNumber} to confirm.` }, 400);
    }

    const res = await g3id(c.env, `/teams/${team.id}`, { method: "DELETE" });
    if (!res.ok) return c.json({ error: await errorOf(res, "G3ID couldn't delete it.") }, 502);
    const { deletedUserIds } = (await res.json()) as { deletedUserIds: string[] };

    await db(c.env).delete(teams).where(eq(teams.id, team.id));
    // An operator whose account went with the team isn't one any more.
    if (deletedUserIds.length) {
      await db(c.env).delete(operators).where(inArray(operators.userId, deletedUserIds));
    }
    await log(c.env, c.get("userId"), "delete_team", {
      teamId: team.id,
      reason,
      details: {
        teamNumber: team.teamNumber,
        name: team.name,
        status: team.status,
        slackWorkspaceName: team.slackWorkspaceName,
        deletedAccounts: deletedUserIds.length,
      },
    });
    return c.json({ ok: true });
  })
  // Moving a team to another number, when it claimed the wrong one. Its addresses change with it.
  .post("/teams/:id/renumber", async (c) => {
    const body = await c.req.json<{ reason?: unknown; teamNumber?: unknown }>();
    const reason = reasonOf(body);
    if (!reason) return c.json({ error: NO_REASON }, 400);
    const teamNumber = Number(body.teamNumber);
    if (!validNumber(teamNumber)) return c.json({ error: "Enter the new team number." }, 400);
    const team = await teamById(c.env, c.req.param("id"));
    if (!team) return c.json({ error: "No such team." }, 404);
    if (team.id === teamKey) {
      return c.json({ error: "The site's own team's number is set in site.ts." }, 409);
    }
    if (teamNumber === team.teamNumber) return c.json({ error: "That's its number already." }, 400);
    const holder = await db(c.env)
      .select({ status: teams.status })
      .from(teams)
      .where(eq(teams.teamNumber, teamNumber))
      .get();
    if (holder) {
      return c.json(
        {
          error:
            holder.status === "pending"
              ? `Someone is signing up team ${teamNumber}. Delete that sign-up first.`
              : `Team ${teamNumber} is already on Gearbox.`,
        },
        409,
      );
    }

    const res = await g3id(c.env, `/teams/${team.id}/renumber`, {
      method: "POST",
      body: { teamNumber },
    });
    if (!res.ok) return c.json({ error: await errorOf(res, "G3ID couldn't renumber it.") }, 409);

    const newId = `frc${teamNumber}`;
    await db(c.env).batch([
      db(c.env)
        .update(teams)
        .set({ id: newId, teamNumber, updatedAt: now() })
        .where(eq(teams.id, team.id)),
      // The team's log follows it to its new id.
      db(c.env)
        .update(operatorActions)
        .set({ teamId: newId })
        .where(eq(operatorActions.teamId, team.id)),
    ]);
    await log(c.env, c.get("userId"), "renumber_team", {
      teamId: newId,
      reason,
      details: { from: team.teamNumber, to: teamNumber },
    });
    return c.json({ id: newId });
  })
  // Handing the team to another of its members, who becomes an admin. The previous owner stays
  // an admin unless the operator says otherwise.
  .post("/teams/:id/owner", async (c) => {
    const body = await c.req.json<{
      reason?: unknown;
      userId?: unknown;
      keepPreviousAdmin?: unknown;
    }>();
    const reason = reasonOf(body);
    if (!reason) return c.json({ error: NO_REASON }, 400);
    if (typeof body.userId !== "string") return c.json({ error: "Choose the new owner." }, 400);
    const team = await teamById(c.env, c.req.param("id"));
    if (!team) return c.json({ error: "No such team." }, 404);
    if (team.status === "pending") {
      return c.json({ error: "This team hasn't finished signing up." }, 409);
    }
    if (body.userId === team.ownerUserId) return c.json({ error: "They own it already." }, 400);

    const previous = team.ownerUserId;
    const res = await g3id(c.env, `/teams/${team.id}/owner`, {
      method: "POST",
      body: {
        userId: body.userId,
        demoteUserId: body.keepPreviousAdmin === false ? previous : null,
      },
    });
    if (!res.ok) return c.json({ error: await errorOf(res, "G3ID couldn't do that.") }, 400);

    await db(c.env)
      .update(teams)
      .set({ ownerUserId: body.userId, updatedAt: now() })
      .where(eq(teams.id, team.id));
    await log(c.env, c.get("userId"), "transfer_owner", {
      teamId: team.id,
      reason,
      details: {
        from: previous,
        to: body.userId,
        previousKeptAdmin: body.keepPreviousAdmin !== false,
      },
    });
    return c.json({ ok: true });
  })
  // Suspending a team takes its addresses away (the gateway only answers active teams) and keeps
  // its data, while a report is looked into.
  .post("/teams/:id/status", async (c) => {
    const body = await c.req.json<{ reason?: unknown; status?: unknown }>();
    const reason = reasonOf(body);
    if (!reason) return c.json({ error: NO_REASON }, 400);
    if (body.status !== "active" && body.status !== "suspended") {
      return c.json({ error: "Choose active or suspended." }, 400);
    }
    const team = await teamById(c.env, c.req.param("id"));
    if (!team) return c.json({ error: "No such team." }, 404);
    if (team.id === teamKey)
      return c.json({ error: "The site's own team can't be suspended." }, 409);
    const from = body.status === "suspended" ? "active" : "suspended";
    if (team.status !== from) return c.json({ error: `The team is ${team.status}.` }, 409);

    await db(c.env)
      .update(teams)
      .set({ status: body.status, updatedAt: now() })
      .where(and(eq(teams.id, team.id), eq(teams.status, from)));
    await log(
      c.env,
      c.get("userId"),
      body.status === "suspended" ? "suspend_team" : "reactivate_team",
      { teamId: team.id, reason },
    );
    return c.json({ ok: true });
  })
  // Reports that a number was falsely registered, newest first, with the team holding it.
  .get("/reports", async (c) => {
    const status = c.req.query("status");
    const reports = await db(c.env)
      .select({
        id: numberReports.id,
        teamNumber: numberReports.teamNumber,
        email: numberReports.email,
        name: numberReports.name,
        message: numberReports.message,
        status: numberReports.status,
        createdAt: numberReports.createdAt,
        resolvedAt: numberReports.resolvedAt,
        teamId: teams.id,
        teamName: teams.name,
        teamStatus: teams.status,
      })
      .from(numberReports)
      .leftJoin(teams, eq(teams.teamNumber, numberReports.teamNumber))
      .where(
        status === "open" || status === "resolved" ? eq(numberReports.status, status) : undefined,
      )
      .orderBy(desc(numberReports.createdAt))
      .limit(500)
      .all();
    return c.json(reports);
  })
  .post("/reports/:id", async (c) => {
    const { status } = await c.req.json<{ status?: unknown }>();
    if (status !== "open" && status !== "resolved") {
      return c.json({ error: "Choose open or resolved." }, 400);
    }
    const report = await db(c.env)
      .select()
      .from(numberReports)
      .where(eq(numberReports.id, c.req.param("id")))
      .get();
    if (!report) return c.json({ error: "No such report." }, 404);
    if (report.status === status) return c.json({ ok: true });
    await db(c.env)
      .update(numberReports)
      .set(
        status === "resolved"
          ? { status, resolvedAt: now(), resolvedBy: c.get("userId") }
          : { status, resolvedAt: null, resolvedBy: null },
      )
      .where(eq(numberReports.id, report.id));
    const team = await db(c.env)
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.teamNumber, report.teamNumber))
      .get();
    await log(c.env, c.get("userId"), status === "resolved" ? "resolve_report" : "reopen_report", {
      teamId: team?.id ?? null,
      details: { reportId: report.id, teamNumber: report.teamNumber },
    });
    return c.json({ ok: true });
  })
  .get("/operators", async (c) => {
    const list = await db(c.env).select().from(operators).orderBy(operators.createdAt).all();
    const names = await accounts(
      c.env,
      list.map((o) => o.userId),
    );
    return c.json(
      list.map((o) => {
        const account = names.get(o.userId);
        return {
          userId: o.userId,
          displayName: account?.displayName ?? null,
          email: account?.email ?? null,
          teamId: account?.teamId ?? null,
          createdAt: o.createdAt,
          isYou: o.userId === c.get("userId"),
        };
      }),
    );
  })
  // Adding an operator by their G3ID account id (the console shows each person theirs).
  .post("/operators", async (c) => {
    const { userId } = await c.req.json<{ userId?: unknown }>();
    if (typeof userId !== "string" || !userId.trim()) {
      return c.json({ error: "Enter their account id." }, 400);
    }
    const account = (await accounts(c.env, [userId.trim()])).get(userId.trim());
    if (!account) return c.json({ error: "No account has that id." }, 404);
    await db(c.env)
      .insert(operators)
      .values({ userId: account.id, addedBy: c.get("userId"), createdAt: now() })
      .onConflictDoNothing();
    await log(c.env, c.get("userId"), "add_operator", {
      details: { userId: account.id, displayName: account.displayName, teamId: account.teamId },
    });
    return c.json({ ok: true }, 201);
  })
  .delete("/operators/:userId", async (c) => {
    const userId = c.req.param("userId");
    if (userId === c.get("userId")) {
      return c.json({ error: "Another operator has to remove you." }, 409);
    }
    const removed = await db(c.env)
      .delete(operators)
      .where(eq(operators.userId, userId))
      .returning({ userId: operators.userId });
    if (removed.length === 0) return c.json({ error: "Not an operator." }, 404);
    await log(c.env, c.get("userId"), "remove_operator", { details: { userId } });
    return c.json({ ok: true });
  })
  // The log, newest first.
  .get("/actions", async (c) => {
    const teamId = c.req.query("teamId");
    const actions = await db(c.env)
      .select()
      .from(operatorActions)
      .where(teamId ? eq(operatorActions.teamId, teamId) : undefined)
      .orderBy(desc(operatorActions.createdAt))
      .limit(300)
      .all();
    const names = await accounts(
      c.env,
      actions.map((a) => a.operatorUserId),
    );
    return c.json(
      actions.map((a) => ({
        ...a,
        details: JSON.parse(a.details) as Record<string, unknown>,
        operatorName: names.get(a.operatorUserId)?.displayName ?? a.operatorUserId,
      })),
    );
  });
