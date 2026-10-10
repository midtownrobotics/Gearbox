import {
  activeMembers,
  deleteTeamRows,
  exportTeamRows,
  logTeamChange,
  requireAuth,
  teamExport,
  teamSettingsRoutes,
} from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { drizzle } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { AttendanceDb, type Session, teamsWithOpenSessions } from "./db";
import {
  attendanceMembers,
  attendanceSessions,
  attendanceSettings,
  attendanceTotals,
} from "./db/schema";
import { manifest } from "./manifest";
import { type AttendanceSettings, autoSignOutMs, parseSettings, schoolYear } from "./settings";
import { currentWindow, validateToken } from "./token";
import type { AppEnv } from "./types";

// Attendance for each team (roadmap Phase 3): every record and setting is the request's team's
// (`c.get("teamId")`, from @g3/auth), kept to it by AttendanceDb.

const MAX_MANUAL_HOURS = 1000;

const base = new Hono<AppEnv>();

base.onError((err, c) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[attendance]", msg);
  return c.json({ error: msg }, 500);
});

base.use(
  "*",
  cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

/** The signed-in user's team's records. */
const teamDb = (c: Context<AppEnv>) => new AttendanceDb(c.env.ATTENDANCE_DB, c.get("teamId"));

async function listOpenSessions(store: AttendanceDb) {
  const [members, sessions] = await Promise.all([store.listMembers(), store.listOpenSessions()]);
  const membersById = new Map(members.map((member) => [member.id, member]));
  return sessions.flatMap((session) => {
    const member = membersById.get(session.memberId);
    return member ? [{ session, member }] : [];
  });
}

async function calculateSchoolYearTotals(
  store: AttendanceDb,
  settings: AttendanceSettings,
  memberId: string,
  year: string,
) {
  const sessions = await store.listSessions(memberId);
  let totalMs = 0;
  let completedSessions = 0;
  for (const session of sessions) {
    const signIn = new Date(session.signIn);
    if (Number.isNaN(signIn.getTime()) || schoolYear(signIn, settings) !== year) continue;
    const duration = session.durationMs;
    if (session.status === "manual-adjustment") {
      const adjustment = session.adjustmentMs;
      if (typeof adjustment === "number" && Number.isFinite(adjustment)) {
        totalMs += adjustment;
      } else if (typeof duration === "number" && Number.isFinite(duration)) {
        // Backward compatibility for positive adjustments created before signed adjustments.
        totalMs += Math.max(0, duration);
      }
      completedSessions++;
      continue;
    }
    // Auto-closed sessions are invalid and never count toward attendance,
    // including records created before this rule stored a zero duration.
    if (session.status === "auto-closed") {
      completedSessions++;
      continue;
    }
    if (typeof duration === "number" && Number.isFinite(duration)) {
      totalMs += Math.max(0, duration);
      completedSessions++;
    }
  }
  return { totalMs: Math.max(0, totalMs), completedSessions };
}

// Human-readable display-name slug joined with the G3ID id for a stable key.
function memberKey(displayName: string, userId: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  return slug ? `${slug}_${userId}` : userId;
}

function validMemberId(memberId: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(memberId);
}

async function closeOpenSession(
  store: AttendanceDb,
  settings: AttendanceSettings,
  memberId: string,
) {
  const open = await store.listOpenSessions(memberId);
  if (!open.length) return null;

  const session = open[0];
  const signInMs = session.signIn;
  if (!Number.isFinite(signInMs)) throw new Error("INVALID_SESSION");

  const limitMs = autoSignOutMs(settings);
  const elapsedMs = Date.now() - signInMs;
  const timedOut = elapsedMs >= limitMs;
  const durationMs = timedOut ? 0 : Math.max(0, elapsedMs);
  await store.closeSession(
    session.id,
    timedOut ? signInMs + limitMs : Date.now(),
    durationMs,
    timedOut ? "auto-closed" : "completed",
  );

  return { durationMs, year: schoolYear(new Date(signInMs), settings) };
}

async function refreshTotal(
  store: AttendanceDb,
  settings: AttendanceSettings,
  memberId: string,
  year: string,
) {
  const { totalMs, completedSessions } = await calculateSchoolYearTotals(
    store,
    settings,
    memberId,
    year,
  );
  await store.setTotal(memberId, year, totalMs, completedSessions);
  return totalMs / 3_600_000;
}

/**
 * The team's active members (G3ID), the only ones who appear on the leaderboard and in the
 * reports; null when G3ID can't say.
 */
async function leaderboardMembers(env: AppEnv["Bindings"], teamId: string) {
  const members = await activeMembers(env, teamId);
  return members?.filter((member) => member.displayName.trim().toLowerCase() !== "admin") ?? null;
}

/** What a session counted for: `ms` is the time it adds to (or, for an adjustment, takes from) hours. */
type Counted = { kind: "completed" | "open" | "missed" | "adjustment"; ms: number };

/**
 * How a session counts, by the one set of rules the summary and the reports share. Time in a
 * session still open counts as it runs. A missed sign-out (closed by the auto sign-out limit, or
 * open past it) counts for nothing. An admin's adjustment counts as given.
 */
function countSession(session: Session, limitMs: number, now: number): Counted {
  if (session.status === "open" || session.signOut == null) {
    const elapsedMs = now - session.signIn;
    return elapsedMs < limitMs
      ? { kind: "open", ms: Math.max(0, elapsedMs) }
      : { kind: "missed", ms: 0 };
  }
  if (session.status === "auto-closed") return { kind: "missed", ms: 0 };
  const duration = session.durationMs;
  const hasDuration = typeof duration === "number" && Number.isFinite(duration);
  if (session.status === "manual-adjustment") {
    const adjustment = session.adjustmentMs;
    if (typeof adjustment === "number" && Number.isFinite(adjustment)) {
      return { kind: "adjustment", ms: adjustment };
    }
    // Adjustments made before they could be negative kept their hours as a duration.
    return { kind: "adjustment", ms: hasDuration ? Math.max(0, duration) : 0 };
  }
  if (hasDuration) return { kind: "completed", ms: Math.max(0, duration) };
  return { kind: "completed", ms: Math.max(0, session.signOut - session.signIn) };
}

async function attendanceSummaries(
  store: AttendanceDb,
  settings: AttendanceSettings,
  year: string,
) {
  const [members, allSessions] = await Promise.all([store.listMembers(), store.listSessions()]);
  const sessionsByMember = new Map<string, typeof allSessions>();
  for (const session of allSessions) {
    const memberSessions = sessionsByMember.get(session.memberId) ?? [];
    memberSessions.push(session);
    sessionsByMember.set(session.memberId, memberSessions);
  }
  const limitMs = autoSignOutMs(settings);
  const now = Date.now();

  return members.map((member) => {
    const sessions = sessionsByMember.get(member.id) ?? [];
    let latestSignIn: Date | null = null;
    let totalMs = 0;
    let signedIn = false;
    for (const session of sessions) {
      const signIn = new Date(session.signIn);
      if (Number.isNaN(signIn.getTime())) continue;
      if (session.status !== "manual-adjustment" && (!latestSignIn || signIn > latestSignIn))
        latestSignIn = signIn;
      if (schoolYear(signIn, settings) !== year) continue;

      const counted = countSession(session, limitMs, now);
      if (counted.kind === "open") signedIn = true;
      totalMs += counted.ms;
    }
    return {
      id: member.id,
      userId: member.userId,
      displayName: member.displayName || member.id,
      email: member.email,
      signedIn,
      lastSignIn: latestSignIn?.toISOString() ?? null,
      totalHours: Math.max(0, totalMs) / 3_600_000,
    };
  });
}

/** Closes the team's sessions left open past its auto sign-out limit; their time doesn't count. */
async function autoSignOut(store: AttendanceDb, settings: AttendanceSettings) {
  const now = Date.now();
  const limitMs = autoSignOutMs(settings);
  const open = await listOpenSessions(store);
  const stale = open
    .map(({ session, member }) => ({ session, member, signIn: new Date(session.signIn) }))
    .filter(({ signIn }) => !Number.isNaN(signIn.getTime()) && now - signIn.getTime() >= limitMs);

  await Promise.all(
    stale.map(async ({ session, member, signIn }) => {
      await store.closeSession(session.id, signIn.getTime() + limitMs, 0, "auto-closed");
      await refreshTotal(store, settings, member.id, schoolYear(signIn, settings));
    }),
  );
  console.log(`Auto-closed ${stale.length} sessions`);
}

const app = base
  .get("/health", (c) =>
    c.json({ status: "ok", service: "attendance", version: packageJson.version }),
  )

  // Who am I — used by the scanned page to show "Sign in as <name>".
  // When an operator deletes the team (the platform's console), or 90 days after the team switches
  // the app off (the platform's app library), its data goes too. Only other workers reach
  // /internal: the gateway never answers it.
  // The team's data, for its admins to download before switching the app off (the platform's app
  // library). Only other workers reach /internal.
  .get("/internal/teams/:teamId/export", async (c) => {
    const teamId = c.req.param("teamId");
    const tables = await exportTeamRows(drizzle(c.env.ATTENDANCE_DB), teamId, [
      attendanceSettings,
      attendanceMembers,
      attendanceSessions,
      attendanceTotals,
    ]);
    return c.json(teamExport(manifest, teamId, tables));
  })
  .delete("/internal/teams/:teamId", async (c) => {
    await deleteTeamRows(drizzle(c.env.ATTENDANCE_DB), c.req.param("teamId"), [
      attendanceSessions,
      attendanceTotals,
      attendanceMembers,
      attendanceSettings,
    ]);
    return c.json({ ok: true });
  })
  .get("/me", requireAuth, (c) =>
    c.json({
      id: c.get("userId"),
      displayName: c.get("userDisplayName"),
      email: c.get("userEmail"),
      isAdmin: c.get("userIsAdmin"),
    }),
  )

  // Current kiosk code — admin only. The kiosk display fetches this to build its
  // QR, so the live presence token is never issued to non-admins.
  .get("/code", requireAuth, (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);
    return c.json({ w: currentWindow() });
  })

  // Sign in — identity from the G3ID session, presence from the kiosk token.
  .post("/signin", requireAuth, async (c) => {
    const { w } = await c.req.json<{ w: number }>();
    try {
      validateToken(w);
    } catch {
      return c.json({ error: "TOKEN_EXPIRED" }, 400);
    }

    const memberId = memberKey(c.get("userDisplayName"), c.get("userId"));
    const store = teamDb(c);
    const settings = await store.settings();
    await autoSignOut(store, settings);

    await store.upsertMember({
      id: memberId,
      displayName: c.get("userDisplayName"),
      email: c.get("userEmail"),
      userId: c.get("userId"),
    });

    const open = await store.listOpenSessions(memberId);
    if (open.length > 0) return c.json({ error: "ALREADY_SIGNED_IN" }, 409);

    const now = new Date();
    await store.addSession({
      memberId,
      signIn: now.getTime(),
      signOut: null,
      durationMs: null,
      adjustmentMs: null,
      status: "open",
      schoolYear: schoolYear(now, settings),
      addedBy: null,
    });

    return c.json({ ok: true });
  })

  // Sign out — same identity/presence model.
  .post("/signout", requireAuth, async (c) => {
    const { w } = await c.req.json<{ w: number }>();
    try {
      validateToken(w);
    } catch {
      return c.json({ error: "TOKEN_EXPIRED" }, 400);
    }

    const memberId = memberKey(c.get("userDisplayName"), c.get("userId"));
    const store = teamDb(c);
    const settings = await store.settings();
    let result: Awaited<ReturnType<typeof closeOpenSession>>;
    try {
      result = await closeOpenSession(store, settings, memberId);
    } catch {
      return c.json({ error: "INVALID_SESSION" }, 500);
    }
    if (!result) return c.json({ error: "NOT_SIGNED_IN" }, 404);

    const totalHours = await refreshTotal(store, settings, memberId, result.year);
    return c.json({ ok: true, durationMs: result.durationMs, totalHours });
  })
  // Manual attendance controls — admin only.
  .post("/admin/members/:memberId/signout", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);
    const memberId = c.req.param("memberId");
    if (!validMemberId(memberId)) return c.json({ error: "Invalid member." }, 400);

    const store = teamDb(c);
    const settings = await store.settings();
    const result = await closeOpenSession(store, settings, memberId);
    if (!result) return c.json({ error: "NOT_SIGNED_IN" }, 404);
    const totalHours = await refreshTotal(store, settings, memberId, result.year);
    return c.json({ ok: true, totalHours });
  })
  // Signs out everyone who is signed in, each with the time they've had so far.
  .post("/admin/signout-all", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);

    const store = teamDb(c);
    const settings = await store.settings();
    const memberIds = [...new Set((await store.listOpenSessions()).map((s) => s.memberId))];
    for (const memberId of memberIds) {
      const result = await closeOpenSession(store, settings, memberId);
      if (result) await refreshTotal(store, settings, memberId, result.year);
    }
    return c.json({ ok: true, signedOut: memberIds.length });
  })
  .post("/admin/members/:memberId/add-hours", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);
    const memberId = c.req.param("memberId");
    if (!validMemberId(memberId)) return c.json({ error: "Invalid member." }, 400);

    const { hours } = await c.req.json<{ hours?: number }>();
    if (
      typeof hours !== "number" ||
      !Number.isFinite(hours) ||
      hours === 0 ||
      Math.abs(hours) > MAX_MANUAL_HOURS
    ) {
      return c.json(
        {
          error: `Hours must be non-zero and between -${MAX_MANUAL_HOURS} and ${MAX_MANUAL_HOURS}.`,
        },
        400,
      );
    }

    const store = teamDb(c);
    if (!(await store.getMember(memberId))) return c.json({ error: "Member not found." }, 404);
    const settings = await store.settings();
    const now = new Date();
    const year = schoolYear(now, settings);
    let appliedHours = hours;
    if (hours < 0) {
      const current = await calculateSchoolYearTotals(store, settings, memberId, year);
      appliedHours = Math.max(hours, -(current.totalMs / 3_600_000));
    }
    if (appliedHours === 0) return c.json({ ok: true, totalHours: 0 });

    await store.addSession({
      memberId,
      signIn: now.getTime(),
      signOut: now.getTime(),
      durationMs: null,
      adjustmentMs: appliedHours * 3_600_000,
      status: "manual-adjustment",
      schoolYear: year,
      addedBy: c.get("userId"),
    });
    const totalHours = await refreshTotal(store, settings, memberId, year);
    return c.json({ ok: true, totalHours });
  })
  .delete("/admin/members/:memberId", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);
    const memberId = c.req.param("memberId");
    if (!validMemberId(memberId)) return c.json({ error: "Invalid member." }, 400);

    const store = teamDb(c);
    if (!(await store.getMember(memberId))) return c.json({ error: "Member not found." }, 404);
    await store.deleteMember(memberId);
    return c.json({ ok: true });
  })
  // The team's attendance settings — admin only (G3ID's Attendance admin page edits them).
  .get("/admin/settings", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);
    return c.json(await teamDb(c).settings());
  })
  .put("/admin/settings", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);
    const settings = parseSettings(await c.req.json().catch(() => null));
    if (typeof settings === "string") return c.json({ error: settings }, 400);
    const before = await teamDb(c).settings();
    await teamDb(c).saveSettings(settings, c.get("userId"));
    const changed = [
      ...(before.schoolYearStartMonth !== settings.schoolYearStartMonth ||
      before.schoolYearStartDay !== settings.schoolYearStartDay
        ? ["School year starts"]
        : []),
      ...(before.autoSignOutHours !== settings.autoSignOutHours ? ["Auto sign-out"] : []),
    ];
    if (changed.length > 0) {
      await logTeamChange(c.env, c.get("teamId"), {
        userId: c.get("userId"),
        app: "attendance",
        what: "Attendance settings",
        changed,
      });
    }
    return c.json(settings);
  })
  // Attendance summary — admin only. One row per member: current status,
  // last sign-in, and total hours for the current year.
  .get("/admin/summary", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);

    const store = teamDb(c);
    const settings = await store.settings();
    const year = schoolYear(new Date(), settings);
    const summaries = await attendanceSummaries(store, settings, year);

    summaries.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return c.json({ year, members: summaries });
  })
  // Attendance reports — any member, for the same people as the leaderboard. Every sign-in and
  // adjustment of the current school year with what it counted for, oldest first. The page lays
  // them out by day in the viewer's own time zone (a team has no time zone of its own), so days
  // aren't worked out here.
  .get("/report", requireAuth, async (c) => {
    const store = teamDb(c);
    const settings = await store.settings();
    const roster = await leaderboardMembers(c.env, c.get("teamId"));
    if (!roster) return c.json({ error: "Unable to verify attendance eligibility." }, 502);
    const year = schoolYear(new Date(), settings);
    const [members, sessions] = await Promise.all([store.listMembers(), store.listSessions()]);

    // The people with an attendance record, by name. Someone whose name changed has more than
    // one record: they're one person here, under the name they have now.
    const people = roster
      .filter((person) => members.some((member) => member.userId === person.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    const indexOfUser = new Map(people.map((person, index) => [person.id, index]));
    const indexOfMember = new Map(
      members.flatMap((member) => {
        const index = indexOfUser.get(member.userId);
        return index === undefined ? [] : [[member.id, index] as const];
      }),
    );
    const limitMs = autoSignOutMs(settings);
    const now = Date.now();

    return c.json({
      year,
      members: people.map((person) => ({
        id: person.id,
        displayName: person.displayName,
        isMentor: person.isMentor,
      })),
      sessions: sessions
        .filter(
          (session) =>
            Number.isFinite(session.signIn) &&
            schoolYear(new Date(session.signIn), settings) === year,
        )
        .sort((a, b) => a.signIn - b.signIn)
        .flatMap((session) => {
          const member = indexOfMember.get(session.memberId);
          if (member === undefined) return [];
          return [{ member, signIn: session.signIn, ...countSession(session, limitMs, now) }];
        }),
    });
  })
  .get("/leaderboard", requireAuth, async (c) => {
    const store = teamDb(c);
    const settings = await store.settings();
    await autoSignOut(store, settings);
    const members = await leaderboardMembers(c.env, c.get("teamId"));
    if (!members) return c.json({ error: "Unable to verify attendance eligibility." }, 502);
    const eligibleNames = new Map(members.map((member) => [member.id, member.displayName]));
    const year = schoolYear(new Date(), settings);
    const summaries = await attendanceSummaries(store, settings, year);
    const totals = new Map<string, { displayName: string; totalHours: number }>();
    for (const summary of summaries) {
      const displayName = eligibleNames.get(summary.userId);
      if (!displayName) continue;
      const current = totals.get(summary.userId);
      totals.set(summary.userId, {
        displayName,
        totalHours: (current?.totalHours ?? 0) + summary.totalHours,
      });
    }
    const leaderboard = Array.from(totals.values())
      .sort(
        (left, right) =>
          right.totalHours - left.totalHours || left.displayName.localeCompare(right.displayName),
      )
      .map((member, index) => ({ rank: index + 1, ...member }));
    return c.json({ year, leaderboard });
  })
  // Who's currently signed in — any logged-in user can view.
  .get("/status", requireAuth, async (c) => {
    const store = teamDb(c);
    await autoSignOut(store, await store.settings());
    const open = await listOpenSessions(store);
    const signedIn = open.map(({ member }) => member.displayName || member.id);

    return c.json({ signedIn });
  })
  // The same settings as /admin/settings for the team's dashboard (roadmap 4.5), by manifest key:
  // the school year's start as "MM-DD".
  .route(
    "/team-settings",
    teamSettingsRoutes<AppEnv>(manifest, "Attendance settings", {
      async read(c) {
        const s = await teamDb(c).settings();
        const pad = (n: number) => String(n).padStart(2, "0");
        return {
          values: {
            schoolYearStart: `${pad(s.schoolYearStartMonth)}-${pad(s.schoolYearStartDay)}`,
            autoSignOutHours: s.autoSignOutHours,
          },
        };
      },
      async save(c, changes) {
        const store = teamDb(c);
        const before = await store.settings();
        const [month, day] =
          typeof changes.schoolYearStart === "string"
            ? changes.schoolYearStart.split("-").map(Number)
            : [before.schoolYearStartMonth, before.schoolYearStartDay];
        const settings = parseSettings({
          schoolYearStartMonth: month,
          schoolYearStartDay: day,
          autoSignOutHours: changes.autoSignOutHours ?? before.autoSignOutHours,
        });
        if (typeof settings === "string") return settings;
        await store.saveSettings(settings, c.get("userId"));
      },
    }),
  );

export type AttendanceApp = typeof app;
/** The Hono app itself, for the isolation test (test/isolation.test.ts). */
export { app };

export default {
  fetch: withApiPrefix(app.fetch),
  // Each team with an open session, by its own auto sign-out limit.
  scheduled: (_event: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) => {
    ctx.waitUntil(
      (async () => {
        for (const teamId of await teamsWithOpenSessions(env.ATTENDANCE_DB)) {
          const store = new AttendanceDb(env.ATTENDANCE_DB, teamId);
          await autoSignOut(store, await store.settings());
        }
      })(),
    );
  },
};
