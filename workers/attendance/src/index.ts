import { requireAuth } from "@g3/auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Firestore } from "./firestore";
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
    origin: (origin) => {
      if (!origin) return null;
      if (origin === "https://g3robotics.com") return origin;
      if (origin.endsWith(".g3robotics.com")) return origin;
      if (origin.startsWith("http://localhost:")) return origin;
      if (origin.startsWith("http://127.0.0.1:")) return origin;
      if (origin.endsWith(".pages.dev")) return origin;
      return null;
    },
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

function db(env: AppEnv["Bindings"]) {
  return new Firestore(
    env.FIREBASE_PROJECT_ID,
    env.FIREBASE_CLIENT_EMAIL,
    env.FIREBASE_PRIVATE_KEY,
  );
}

async function listOpenSessions(fs: Firestore) {
  // A collection-group query is one Firestore subrequest regardless of member
  // count. Filter locally because a status filter requires a collection-group
  // field index that is not configured for this project.
  const [members, sessions] = await Promise.all([
    fs.listCollection("members"),
    fs.collectionGroupQuery("sessions", []),
  ]);
  const membersById = new Map(members.map((member) => [member.id, member]));

  return sessions.flatMap((session) => {
    if (session.data.status !== "open") return [];
    const match = session.path.match(/\/members\/([^/]+)\/sessions\//);
    const member = match ? membersById.get(match[1]) : undefined;
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

async function calculateSchoolYearTotals(fs: Firestore, memberId: string, year: string) {
  const sessions = await fs.listCollection(`members/${memberId}/sessions`);
  let totalMs = 0;
  let completedSessions = 0;
  for (const session of sessions) {
    const raw = session.data.signIn;
    const signIn = raw instanceof Date ? raw : new Date(raw as string);
    if (Number.isNaN(signIn.getTime()) || schoolYear(signIn) !== year) continue;
    const duration = session.data.durationMs;
    if (session.data.status === "manual-adjustment") {
      const adjustment = session.data.adjustmentMs;
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
    if (session.data.status === "auto-closed") {
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

// Firestore document key — the display-name slug joined with the G3ID id, so
// docs are both human-readable in the Firebase console and guaranteed unique
// (e.g. members/jane_doe_abc123). The full identity is also stored as fields.
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

async function closeOpenSession(fs: Firestore, memberId: string) {
  const sessionsPath = `members/${memberId}/sessions`;
  const open = await fs.query(sessionsPath, [{ field: "status", op: "EQUAL", value: "open" }]);
  if (!open.length) return null;

  const session = open[0];
  const signInRaw = session.data.signIn;
  const signInMs =
    signInRaw instanceof Date ? signInRaw.getTime() : new Date(signInRaw as string).getTime();
  if (!Number.isFinite(signInMs)) throw new Error("INVALID_SESSION");

  const elapsedMs = Date.now() - signInMs;
  const timedOut = elapsedMs >= AUTO_SIGNOUT_MS;
  const durationMs = timedOut ? 0 : Math.max(0, elapsedMs);
  await fs.updateDoc(session.path, {
    signOut: timedOut ? new Date(signInMs + AUTO_SIGNOUT_MS) : new Date(),
    durationMs,
    status: timedOut ? "auto-closed" : "completed",
  });

  return { durationMs, year: schoolYear(new Date(signInMs)) };
}

async function refreshTotal(fs: Firestore, memberId: string, year: string) {
  const { totalMs, completedSessions } = await calculateSchoolYearTotals(fs, memberId, year);
  await fs.setDoc(`members/${memberId}/totals/${year}`, {
    totalMs,
    totalHours: totalMs / 3_600_000,
    sessions: completedSessions,
    year,
  });
  return totalMs / 3_600_000;
}

async function attendanceSummaries(fs: Firestore, year: string) {
  const [members, allSessions] = await Promise.all([
    fs.listCollection("members"),
    fs.collectionGroupQuery("sessions", []),
  ]);
  const sessionsByMember = new Map<string, typeof allSessions>();
  for (const session of allSessions) {
    const match = session.path.match(/\/members\/([^/]+)\/sessions\//);
    if (!match) continue;
    const memberSessions = sessionsByMember.get(match[1]) ?? [];
    memberSessions.push(session);
    sessionsByMember.set(match[1], memberSessions);
  }

  return members.map((member) => {
    const sessions = sessionsByMember.get(member.id) ?? [];
    let latestSignIn: Date | null = null;
    let totalMs = 0;
    let signedIn = false;
    for (const session of sessions) {
      const signInRaw = session.data.signIn;
      const signIn = signInRaw instanceof Date ? signInRaw : new Date(signInRaw as string);
      if (Number.isNaN(signIn.getTime())) continue;
      if (session.data.status !== "manual-adjustment" && (!latestSignIn || signIn > latestSignIn))
        latestSignIn = signIn;
      if (schoolYear(signIn) !== year) continue;

      const isOpen = session.data.status === "open" || session.data.signOut == null;
      if (isOpen) {
        const elapsedMs = Date.now() - signIn.getTime();
        if (elapsedMs < AUTO_SIGNOUT_MS) {
          signedIn = true;
          totalMs += Math.max(0, elapsedMs);
        }
        continue;
      }
      if (session.data.status === "auto-closed") continue;
      if (session.data.status === "manual-adjustment") {
        const adjustmentMs = session.data.adjustmentMs;
        const legacyDurationMs = session.data.durationMs;
        if (typeof adjustmentMs === "number" && Number.isFinite(adjustmentMs))
          totalMs += adjustmentMs;
        else if (typeof legacyDurationMs === "number" && Number.isFinite(legacyDurationMs))
          totalMs += Math.max(0, legacyDurationMs);
        continue;
      }
      const durationMs = session.data.durationMs;
      if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
        totalMs += Math.max(0, durationMs);
        continue;
      }
      const signOutRaw = session.data.signOut;
      const signOut = signOutRaw instanceof Date ? signOutRaw : new Date(signOutRaw as string);
      if (!Number.isNaN(signOut.getTime()))
        totalMs += Math.max(0, signOut.getTime() - signIn.getTime());
    }
    return {
      id: member.id,
      userId: (member.data.userId as string) ?? "",
      displayName: (member.data.displayName as string) ?? member.id,
      email: (member.data.email as string) ?? "",
      signedIn,
      lastSignIn: latestSignIn?.toISOString() ?? null,
      totalHours: Math.max(0, totalMs) / 3_600_000,
    };
  });
}

const app = base
  .get("/health", (c) => c.json({ status: "ok", service: "attendance" }))

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
    const fs = db(c.env);
    const sessionsPath = `members/${memberId}/sessions`;
    await autoSignOut(c.env);

    await fs.setDoc(`members/${memberId}`, {
      displayName: c.get("userDisplayName"),
      email: c.get("userEmail"),
      userId: c.get("userId"),
    });

    const open = await fs.query(sessionsPath, [{ field: "status", op: "EQUAL", value: "open" }]);
    if (open.length > 0) return c.json({ error: "ALREADY_SIGNED_IN" }, 409);

    await fs.addDoc(sessionsPath, {
      signIn: new Date(),
      signOut: null,
      durationMs: null,
      status: "open",
      year: schoolYear(new Date()),
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
    const fs = db(c.env);
    let result: Awaited<ReturnType<typeof closeOpenSession>>;
    try {
      result = await closeOpenSession(fs, memberId);
    } catch {
      return c.json({ error: "INVALID_SESSION" }, 500);
    }
    if (!result) return c.json({ error: "NOT_SIGNED_IN" }, 404);

    const totalHours = await refreshTotal(fs, memberId, result.year);
    return c.json({ ok: true, durationMs: result.durationMs, totalHours });
  })
  // Manual attendance controls — admin only.
  .post("/admin/members/:memberId/signout", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);
    const memberId = c.req.param("memberId");
    if (!validMemberId(memberId)) return c.json({ error: "Invalid member." }, 400);

    const fs = db(c.env);
    const result = await closeOpenSession(fs, memberId);
    if (!result) return c.json({ error: "NOT_SIGNED_IN" }, 404);
    const totalHours = await refreshTotal(fs, memberId, result.year);
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

    const fs = db(c.env);
    if (!(await fs.getDoc(`members/${memberId}`)))
      return c.json({ error: "Member not found." }, 404);
    const now = new Date();
    const year = schoolYear(now);
    let appliedHours = hours;
    if (hours < 0) {
      const current = await calculateSchoolYearTotals(fs, memberId, year);
      appliedHours = Math.max(hours, -(current.totalMs / 3_600_000));
    }
    if (appliedHours === 0) return c.json({ ok: true, totalHours: 0 });

    await fs.addDoc(`members/${memberId}/sessions`, {
      signIn: now,
      signOut: now,
      adjustmentMs: appliedHours * 3_600_000,
      status: "manual-adjustment",
      year,
      addedBy: c.get("userId"),
    });
    const totalHours = await refreshTotal(fs, memberId, year);
    return c.json({ ok: true, totalHours });
  })
  .delete("/admin/members/:memberId", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);
    const memberId = c.req.param("memberId");
    if (!validMemberId(memberId)) return c.json({ error: "Invalid member." }, 400);

    const fs = db(c.env);
    const memberPath = `members/${memberId}`;
    if (!(await fs.getDoc(memberPath))) return c.json({ error: "Member not found." }, 404);

    const [sessions, totals] = await Promise.all([
      fs.listCollection(`${memberPath}/sessions`),
      fs.listCollection(`${memberPath}/totals`),
    ]);
    await fs.deleteDocs([...sessions, ...totals].map((document) => document.path));
    await fs.deleteDoc(memberPath);
    return c.json({ ok: true });
  })
  // Attendance summary — admin only. One row per member: current status,
  // last sign-in, and total hours for the current year.
  .get("/admin/summary", requireAuth, async (c) => {
    if (!c.get("userIsAdmin")) return c.json({ error: "Forbidden." }, 403);

    const fs = db(c.env);
    const year = schoolYear(new Date());
    const summaries = await attendanceSummaries(fs, year);

    summaries.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return c.json({ year, members: summaries });
  })
  .get("/leaderboard", requireAuth, async (c) => {
    await autoSignOut(c.env);
    const eligibilityResponse = await c.env.G3ID.fetch(
      new Request("http://g3id/users/attendance-eligible", {
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
    const fs = db(c.env);
    const open = await listOpenSessions(fs);
    const signedIn = open.map(({ member }) => (member.data.displayName as string) ?? member.id);

    return c.json({ signedIn });
  });

async function autoSignOut(env: AppEnv["Bindings"]) {
  const fs = db(env);
  const now = Date.now();
  const open = await listOpenSessions(fs);
  const stale = open
    .map(({ session, member }) => {
      const raw = session.data.signIn;
      const signIn = raw instanceof Date ? raw : new Date(raw as string);
      return { session, member, signIn };
    })
    .filter(
      ({ signIn }) => !Number.isNaN(signIn.getTime()) && now - signIn.getTime() >= AUTO_SIGNOUT_MS,
    );

  await Promise.all(
    stale.map(async ({ session, member, signIn }) => {
      await fs.updateDoc(session.path, {
        signOut: new Date(signIn.getTime() + AUTO_SIGNOUT_MS),
        durationMs: 0,
        status: "auto-closed",
      });
      const year = schoolYear(signIn);
      const totalPath = `members/${member.id}/totals/${year}`;
      const { totalMs, completedSessions } = await calculateSchoolYearTotals(fs, member.id, year);
      await fs.setDoc(totalPath, {
        totalMs,
        totalHours: totalMs / 3_600_000,
        sessions: completedSessions,
        year,
      });
    }),
  );
  console.log(`Auto-closed ${stale.length} sessions`);
}

export type AttendanceApp = typeof app;

export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) => {
    ctx.waitUntil(autoSignOut(env));
  },
};
