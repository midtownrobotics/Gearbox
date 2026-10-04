import { requireAuth } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { AttendanceDb } from "./db";
import { currentWindow, validateToken } from "./token";
import type { AppEnv } from "./types";

const AUTO_SIGNOUT_MS = 12 * 60 * 60 * 1000;
const SCHOOL_YEAR_START_MONTH = 7; // August (zero-based)
const SCHOOL_YEAR_START_DAY = 3;
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
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

function db(env: AppEnv["Bindings"]) {
  return new AttendanceDb(env.ATTENDANCE_DB);
}

async function listOpenSessions(store: AttendanceDb) {
  const [members, sessions] = await Promise.all([store.listMembers(), store.listOpenSessions()]);
  const membersById = new Map(members.map((member) => [member.id, member]));
  return sessions.flatMap((session) => {
    const member = membersById.get(session.memberId);
    return member ? [{ session, member }] : [];
  });
}

function schoolYear(date: Date): string {
  const startsThisYear =
    date.getMonth() > SCHOOL_YEAR_START_MONTH ||
    (date.getMonth() === SCHOOL_YEAR_START_MONTH && date.getDate() >= SCHOOL_YEAR_START_DAY);
  const start = startsThisYear ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

async function calculateSchoolYearTotals(store: AttendanceDb, memberId: string, year: string) {
  const sessions = await store.listSessions(memberId);
  let totalMs = 0;
  let completedSessions = 0;
  for (const session of sessions) {
    const signIn = new Date(session.signIn);
    if (Number.isNaN(signIn.getTime()) || schoolYear(signIn) !== year) continue;
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
  return /^[a-zA-Z0-9_-]+$/.test(memberId);
}

async function closeOpenSession(store: AttendanceDb, memberId: string) {
  const open = await store.listOpenSessions(memberId);
  if (!open.length) return null;

  const session = open[0];
  const signInMs = session.signIn;
  if (!Number.isFinite(signInMs)) throw new Error("INVALID_SESSION");

  const elapsedMs = Date.now() - signInMs;
  const timedOut = elapsedMs >= AUTO_SIGNOUT_MS;
  const durationMs = timedOut ? 0 : Math.max(0, elapsedMs);
  await store.closeSession(
    session.id,
    timedOut ? signInMs + AUTO_SIGNOUT_MS : Date.now(),
    durationMs,
    timedOut ? "auto-closed" : "completed",
  );

  return { durationMs, year: schoolYear(new Date(signInMs)) };
}

async function refreshTotal(store: AttendanceDb, memberId: string, year: string) {
  const { totalMs, completedSessions } = await calculateSchoolYearTotals(store, memberId, year);
  await store.setTotal(memberId, year, totalMs, completedSessions);
  return totalMs / 3_600_000;
}

async function attendanceSummaries(store: AttendanceDb, year: string) {
  const [members, allSessions] = await Promise.all([store.listMembers(), store.listSessions()]);
  const sessionsByMember = new Map<string, typeof allSessions>();
  for (const session of allSessions) {
    const memberSessions = sessionsByMember.get(session.memberId) ?? [];
    memberSessions.push(session);
    sessionsByMember.set(session.memberId, memberSessions);
  }

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
      if (schoolYear(signIn) !== year) continue;

      const isOpen = session.status === "open" || session.signOut == null;
      if (isOpen) {
        const elapsedMs = Date.now() - signIn.getTime();
        if (elapsedMs < AUTO_SIGNOUT_MS) {
          signedIn = true;
          totalMs += Math.max(0, elapsedMs);
        }
        continue;
      }
      if (session.status === "auto-closed") continue;
      if (session.status === "manual-adjustment") {
        const adjustmentMs = session.adjustmentMs;
        const legacyDurationMs = session.durationMs;
        if (typeof adjustmentMs === "number" && Number.isFinite(adjustmentMs))
          totalMs += adjustmentMs;
        else if (typeof legacyDurationMs === "number" && Number.isFinite(legacyDurationMs))
          totalMs += Math.max(0, legacyDurationMs);
        continue;
      }
      const durationMs = session.durationMs;
      if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
        totalMs += Math.max(0, durationMs);
        continue;
      }
      const signOut = new Date(session.signOut ?? Number.NaN);
      if (!Number.isNaN(signOut.getTime()))
        totalMs += Math.max(0, signOut.getTime() - signIn.getTime());
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

const app = base
  .get("/health", (c) =>
    c.json({ status: "ok", service: "attendance", version: packageJson.version }),
  )

  // Who am I — used by the scanned page to show "Sign in as <name>".
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
    const store = db(c.env);
    await autoSignOut(c.env);

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
      year: schoolYear(now),
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
    const store = db(c.env);
    let result: Awaited<ReturnType<typeof closeOpenSession>>;
    try {
      result = await closeOpenSession(store, memberId);
    } catch {
      return c.json({ error: "INVALID_SESSION" }, 500);
    }
    if (!result) return c.json({ error: "NOT_SIGNED_IN" }, 404);

    const totalHours = await refreshTotal(store, memberId, result.year);
    return c.json({ ok: true, durationMs: result.durationMs, totalHours });
  })
  // Manual attendance controls — admin only.
  .post("/admin/members/:memberId/signout", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);
    const memberId = c.req.param("memberId");
    if (!validMemberId(memberId)) return c.json({ error: "Invalid member." }, 400);

    const store = db(c.env);
    const result = await closeOpenSession(store, memberId);
    if (!result) return c.json({ error: "NOT_SIGNED_IN" }, 404);
    const totalHours = await refreshTotal(store, memberId, result.year);
    return c.json({ ok: true, totalHours });
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

    const store = db(c.env);
    if (!(await store.getMember(memberId))) return c.json({ error: "Member not found." }, 404);
    const now = new Date();
    const year = schoolYear(now);
    let appliedHours = hours;
    if (hours < 0) {
      const current = await calculateSchoolYearTotals(store, memberId, year);
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
      year,
      addedBy: c.get("userId"),
    });
    const totalHours = await refreshTotal(store, memberId, year);
    return c.json({ ok: true, totalHours });
  })
  .delete("/admin/members/:memberId", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);
    const memberId = c.req.param("memberId");
    if (!validMemberId(memberId)) return c.json({ error: "Invalid member." }, 400);

    const store = db(c.env);
    if (!(await store.getMember(memberId))) return c.json({ error: "Member not found." }, 404);
    await store.deleteMember(memberId);
    return c.json({ ok: true });
  })
  // Attendance summary — admin only. One row per member: current status,
  // last sign-in, and total hours for the current year.
  .get("/admin/summary", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);

    const store = db(c.env);
    const year = schoolYear(new Date());
    const summaries = await attendanceSummaries(store, year);

    summaries.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return c.json({ year, members: summaries });
  })
  .get("/leaderboard", requireAuth, async (c) => {
    await autoSignOut(c.env);
    const eligibilityResponse = await c.env.G3ID.fetch(
      new Request("http://g3id/api/users/attendance-eligible", {
        headers: { cookie: c.req.header("Cookie") ?? "" },
      }),
    );
    if (!eligibilityResponse.ok)
      return c.json({ error: "Unable to verify attendance eligibility." }, 502);
    const eligibility = (await eligibilityResponse.json()) as {
      users: { id: string; displayName: string }[];
    };
    const eligibleNames = new Map(eligibility.users.map((user) => [user.id, user.displayName]));
    const year = schoolYear(new Date());
    const summaries = await attendanceSummaries(db(c.env), year);
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
    await autoSignOut(c.env);
    const store = db(c.env);
    const open = await listOpenSessions(store);
    const signedIn = open.map(({ member }) => member.displayName || member.id);

    return c.json({ signedIn });
  });

async function autoSignOut(env: AppEnv["Bindings"]) {
  const store = db(env);
  const now = Date.now();
  const open = await listOpenSessions(store);
  const stale = open
    .map(({ session, member }) => {
      const signIn = new Date(session.signIn);
      return { session, member, signIn };
    })
    .filter(
      ({ signIn }) => !Number.isNaN(signIn.getTime()) && now - signIn.getTime() >= AUTO_SIGNOUT_MS,
    );

  await Promise.all(
    stale.map(async ({ session, member, signIn }) => {
      await store.closeSession(session.id, signIn.getTime() + AUTO_SIGNOUT_MS, 0, "auto-closed");
      const year = schoolYear(signIn);
      const { totalMs, completedSessions } = await calculateSchoolYearTotals(
        store,
        member.id,
        year,
      );
      await store.setTotal(member.id, year, totalMs, completedSessions);
    }),
  );
  console.log(`Auto-closed ${stale.length} sessions`);
}

export type AttendanceApp = typeof app;

export default {
  fetch: withApiPrefix(app.fetch),
  scheduled: (_event: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) => {
    ctx.waitUntil(autoSignOut(env));
  },
};
