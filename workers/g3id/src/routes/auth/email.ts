import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createDb } from "../../db";
import { coreUserIdentities, coreUsers } from "../../db/schema";
import { sessionCookieOptions } from "../../lib/cookie";
import { newId } from "../../lib/id";
import { hashPassword, verifyPassword } from "../../lib/password";
import { createSession } from "../../lib/session";
import { requestTeamId, siteTeamId, teamOfUser } from "../../lib/team";
import { requireAuth } from "../../middleware/auth";
import type { AppEnv } from "../../types";

export const emailAuthRouter = new Hono<AppEnv>()
  .post("/login/email", async (c) => {
    let body: { email?: unknown; password?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request body." }, 400);
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return c.json({ error: "Email and password are required." }, 400);
    }

    const db = createDb(c.env.DB);

    // Create bootstrap admin (email: admin@localhost, password: password) if no admins exist
    const anyAdmin = await db
      .select({ id: coreUsers.id })
      .from(coreUsers)
      .where(eq(coreUsers.isAdmin, 1))
      .limit(1)
      .get();
    if (!anyAdmin) {
      try {
        const now = Math.floor(Date.now() / 1000);
        // If the bootstrap user already exists (e.g. was demoted), just re-promote it
        const existing = await db
          .select({ id: coreUsers.id })
          .from(coreUsers)
          .where(eq(coreUsers.email, "admin@localhost"))
          .get();
        if (existing) {
          await db
            .update(coreUsers)
            .set({ isAdmin: 1, status: "active", updatedAt: now })
            .where(eq(coreUsers.id, existing.id));
        } else {
          const userId = newId();
          const passwordHash = await hashPassword("password");
          await db.batch([
            db.insert(coreUsers).values({
              id: userId,
              teamId: siteTeamId,
              email: "admin@localhost",
              displayName: "Admin",
              status: "active",
              isAdmin: 1,
              createdAt: now,
              updatedAt: now,
            }),
            db.insert(coreUserIdentities).values({
              id: newId(),
              userId,
              provider: "local",
              passwordHash,
              createdAt: now,
              updatedAt: now,
            }),
          ]);
        }
      } catch {
        // Race condition — another request already handled bootstrap
      }
    }

    const invalidError = { error: "Invalid email or password." };

    const user = await db
      .select({ id: coreUsers.id, teamId: coreUsers.teamId, status: coreUsers.status })
      .from(coreUsers)
      .where(eq(coreUsers.email, email))
      .get();

    if (!user) return c.json(invalidError, 401);

    const identity = await db
      .select({ passwordHash: coreUserIdentities.passwordHash })
      .from(coreUserIdentities)
      .where(
        and(
          eq(coreUserIdentities.userId, user.id as string),
          eq(coreUserIdentities.provider, "local"),
        ),
      )
      .get();

    if (!identity?.passwordHash) return c.json(invalidError, 401);

    const valid = await verifyPassword(password, identity.passwordHash);
    if (!valid) return c.json(invalidError, 401);

    // Only after the password, so this never tells anyone else whether an email has an account.
    if (user.teamId !== requestTeamId(c)) {
      return c.json(
        { error: "This account belongs to another team. Sign in on your own team's page." },
        403,
      );
    }

    if (user.status === "pending") {
      return c.json({ error: "Your account is awaiting admin approval." }, 403);
    }
    if (user.status !== "active") {
      return c.json({ error: "Your account is not active." }, 403);
    }

    const sessionId = await createSession(user.id as string, c.env);
    setCookie(c, "g3_session", sessionId, sessionCookieOptions(c.env.FRONTEND_URL));

    return c.json({ ok: true });
  })
  .post("/password", requireAuth, async (c) => {
    let body: { password?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request body." }, 400);
    }

    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8) {
      return c.json({ error: "Password must be at least 8 characters." }, 400);
    }

    const userId = c.get("userId") as string;
    const db = createDb(c.env.DB);

    const existing = await db
      .select({ id: coreUserIdentities.id })
      .from(coreUserIdentities)
      .where(and(eq(coreUserIdentities.userId, userId), eq(coreUserIdentities.provider, "local")))
      .get();

    if (existing) {
      return c.json({ error: "A password is already set on this account." }, 409);
    }

    const now = Math.floor(Date.now() / 1000);
    const passwordHash = await hashPassword(password);

    await db.insert(coreUserIdentities).values({
      id: newId(),
      userId,
      provider: "local",
      passwordHash,
      createdAt: now,
      updatedAt: now,
    });

    return c.json({ ok: true });
  })
  .get("/dev/create-user", requireAuth, async (c) => {
    if (c.env.ENVIRONMENT !== "development") {
      return c.json({ error: "Not available in this environment." }, 403);
    }

    const userId = c.get("userId") as string;
    const db = createDb(c.env.DB);

    const admin = await db
      .select({ isAdmin: coreUsers.isAdmin })
      .from(coreUsers)
      .where(eq(coreUsers.id, userId))
      .get();

    if (!admin || admin.isAdmin !== 1) {
      return c.json({ error: "Admin access required." }, 403);
    }

    const email = c.req.query("email")?.toLowerCase().trim();
    const password = c.req.query("password");
    const displayName = c.req.query("name") || email?.split("@")[0] || "Test User";

    if (!email || !password) {
      return c.json({ error: "email and password query params required" }, 400);
    }
    if (password.length < 8) {
      return c.json({ error: "Password must be at least 8 characters." }, 400);
    }

    const existing = await db
      .select({ id: coreUsers.id })
      .from(coreUsers)
      .where(eq(coreUsers.email, email))
      .get();

    if (existing) {
      return c.json({ error: "User already exists with that email." }, 409);
    }

    const now = Math.floor(Date.now() / 1000);
    const newUserId = newId();
    const passwordHash = await hashPassword(password);

    await db.batch([
      db.insert(coreUsers).values({
        id: newUserId,
        teamId: await teamOfUser(db, userId),
        email,
        displayName,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(coreUserIdentities).values({
        id: newId(),
        userId: newUserId,
        provider: "local",
        passwordHash,
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    return c.json({ ok: true, userId: newUserId, email });
  });
