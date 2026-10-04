import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

// Sign-in for every worker except G3ID itself: ask G3ID (the G3ID service binding) who the
// request's session cookie belongs to. G3ID never reports admin or mentor for a kiosk PIN session,
// so role checks here are safe from kiosks without checking the session type again.

/** What G3ID's /auth/me says about the signed-in user. */
type G3IdMe = {
  id: string;
  displayName: string;
  email: string;
  isAdmin?: boolean;
  isMentor?: boolean;
  sessionType?: "oauth" | "pin";
  kioskDeviceId?: number;
  kioskDeviceName?: string;
  identities?: { provider: string; providerId: string }[];
};

/** The signed-in user, as context variables (`c.get("userId")`, ...). */
export type G3AuthVariables = {
  userId: string;
  userDisplayName: string;
  userEmail: string;
  /** G3ID admin. Never true on a kiosk PIN session. */
  userIsAdmin: boolean;
  /** G3ID mentor flag (admins aren't mentors unless also flagged). Never true on a PIN session. */
  userIsMentor: boolean;
  /** "pin" when signed in with a PIN on a shop kiosk. */
  sessionType: "oauth" | "pin";
  kioskDeviceId: number | null;
  kioskDeviceName: string | null;
  /** The user's linked Slack account; only loaded by `requireAuthWithIdentities`. */
  userSlackId: string | null;
};

/** What a worker needs for these middlewares: the G3ID binding and the user variables. */
export type G3AuthEnv = {
  Bindings: { G3ID: Fetcher };
  Variables: G3AuthVariables;
};

async function loadUser(c: Context<G3AuthEnv>, identities: boolean) {
  const res = await c.env.G3ID.fetch(
    new Request(`http://g3id/api/auth/me${identities ? "" : "?includeIdentities=false"}`, {
      headers: { cookie: c.req.header("Cookie") ?? "" },
    }),
  );
  if (!res.ok) return null;
  const user = (await res.json()) as G3IdMe;
  c.set("userId", user.id);
  c.set("userDisplayName", user.displayName);
  c.set("userEmail", user.email);
  c.set("userIsAdmin", user.isAdmin === true);
  c.set("userIsMentor", user.isMentor === true);
  c.set("sessionType", user.sessionType ?? "oauth");
  c.set("kioskDeviceId", user.kioskDeviceId ?? null);
  c.set("kioskDeviceName", user.kioskDeviceName ?? null);
  c.set(
    "userSlackId",
    user.identities?.find((identity) => identity.provider === "slack")?.providerId ?? null,
  );
  return user;
}

const unauthorized = (c: Context) => c.json({ error: "Unauthorized." }, 401);

/** Any signed-in user (401 otherwise). */
export const requireAuth: MiddlewareHandler<G3AuthEnv> = createMiddleware<G3AuthEnv>(
  async (c, next) => {
    if (!(await loadUser(c, false))) return unauthorized(c);
    await next();
  },
);

/** Like requireAuth, also loading linked accounts (`userSlackId`). G3ID does more work for it. */
export const requireAuthWithIdentities: MiddlewareHandler<G3AuthEnv> = createMiddleware<G3AuthEnv>(
  async (c, next) => {
    if (!(await loadUser(c, true))) return unauthorized(c);
    await next();
  },
);

/** G3ID admins only (403 otherwise). */
export const requireAdmin: MiddlewareHandler<G3AuthEnv> = createMiddleware<G3AuthEnv>(
  async (c, next) => {
    if (!(await loadUser(c, false))) return unauthorized(c);
    if (!c.get("userIsAdmin")) return c.json({ error: "Admin access required." }, 403);
    await next();
  },
);

/** Mentors or admins: who may act as a mentor in an app. Takes any worker's context. */
export const hasMentorAccess = (c: { get(key: "userIsMentor" | "userIsAdmin"): boolean }) =>
  c.get("userIsMentor") || c.get("userIsAdmin");

/** G3ID mentors and admins only (403 otherwise). */
export const requireMentor: MiddlewareHandler<G3AuthEnv> = createMiddleware<G3AuthEnv>(
  async (c, next) => {
    if (!(await loadUser(c, false))) return unauthorized(c);
    if (!hasMentorAccess(c)) return c.json({ error: "Mentor access required." }, 403);
    await next();
  },
);

/**
 * Not from a kiosk PIN session (403 otherwise). Goes after requireAuth; for actions an app lets
 * its own (not G3ID) mentors take, which G3ID's role flags don't already keep from kiosks.
 */
export const requireOAuthSession: MiddlewareHandler<G3AuthEnv> = createMiddleware<G3AuthEnv>(
  async (c, next) => {
    if (c.get("sessionType") === "pin") {
      return c.json({ error: "Not allowed from a kiosk." }, 403);
    }
    await next();
  },
);
