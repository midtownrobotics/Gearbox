import { teamKey } from "@g3/site-config";
import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppManifest, AppPermissionDefinition } from "./manifest";
import type { PermissionApp } from "./permissions";

// Sign-in for every worker except G3ID itself: ask G3ID (the G3ID service binding) who the
// request's session cookie belongs to. G3ID never reports admin or mentor for a kiosk PIN session,
// so role checks here are safe from kiosks without checking the session type again.
//
// The team is the address's: the gateway sets X-Team-Id after removing any a client sent (the site's
// team when there's none: an app's own port in dev, tests). A session counts only on its own team's
// addresses, so `teamId` is always the signed-in user's team. Who is signed in still comes from
// G3ID, never from the gateway's user headers alone, so a request that skipped the gateway can't
// claim to be anyone.

/** The header the gateway names the request's team in. */
export const TEAM_HEADER = "X-Team-Id";

/** The team the request is for: its address's (the gateway's X-Team-Id), else the site's team. */
export const requestTeamId = (c: { req: { header(name: string): string | undefined } }) =>
  c.req.header(TEAM_HEADER) || teamKey;

/** What G3ID's /auth/me says about the signed-in user. */
type G3IdMe = {
  id: string;
  teamId?: string;
  displayName: string;
  email: string;
  isAdmin?: boolean;
  isIdentityAdmin?: boolean;
  isMentor?: boolean;
  permissions?: string[];
  sessionType?: "oauth" | "pin";
  kioskDeviceId?: number;
  kioskDeviceName?: string;
  identities?: { provider: string; providerId: string }[];
};

/** The signed-in user, as context variables (`c.get("userId")`, ...). */
export type G3AuthVariables = {
  /** The team the request is for, which is the signed-in user's team. */
  teamId: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  /** Site-wide Admin. Delegated app permissions never change this role. */
  userIsAdmin: boolean;
  /** Compatibility name for site-wide Admin authority, never a delegated student grant. */
  userIsIdentityAdmin: boolean;
  /** Set by the worker, never read from client headers or request bodies. */
  permissionApp?: PermissionApp;
  permissionDefinitions?: AppPermissionDefinition[];
  userPermissions: string[];
  /** Site-wide Mentor role. Never true on PIN. */
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
  const query = new URLSearchParams();
  if (!identities) query.set("includeIdentities", "false");
  const app = c.get("permissionApp");
  if (app) query.set("app", app);
  const res = await c.env.G3ID.fetch(
    new Request(`http://g3id/api/auth/me?${query}`, {
      headers: { cookie: c.req.header("Cookie") ?? "", [TEAM_HEADER]: requestTeamId(c) },
    }),
  );
  if (!res.ok) return null;
  const user = (await res.json()) as G3IdMe;
  // Another team's member is signed out here (the gateway drops their session too).
  const team = requestTeamId(c);
  if (user.teamId && user.teamId !== team) return null;
  c.set("teamId", team);
  c.set("userId", user.id);
  c.set("userDisplayName", user.displayName);
  c.set("userEmail", user.email);
  const kiosk = user.sessionType === "pin";
  c.set("userIsAdmin", !kiosk && user.isAdmin === true);
  c.set("userIsIdentityAdmin", !kiosk && (user.isIdentityAdmin ?? user.isAdmin) === true);
  c.set("userIsMentor", !kiosk && user.isMentor === true);
  c.set("userPermissions", !kiosk && Array.isArray(user.permissions) ? user.permissions : []);
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

/** Each worker declares which app's permissions it enforces before mounting its routes. */
export const appAuthContext = (app: AppManifest): MiddlewareHandler<G3AuthEnv> =>
  createMiddleware<G3AuthEnv>(async (c, next) => {
    c.set("permissionApp", app.slug);
    c.set("permissionDefinitions", app.permissions);
    await next();
  });

/** Only site-wide Admins assign roles and student permissions. */
export const requireIdentityAdmin: MiddlewareHandler<G3AuthEnv> = createMiddleware<G3AuthEnv>(
  async (c, next) => {
    if (!(await loadUser(c, false))) return unauthorized(c);
    if (!c.get("userIsIdentityAdmin"))
      return c.json({ error: "Only Admins can assign permissions." }, 403);
    await next();
  },
);

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

/** Site-wide Admins (403 otherwise); use requirePermission for delegated app capabilities. */
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

/** Admin grants everything. Mentor defaults and student grants come from the app manifest. */
export function hasPermission(c: Pick<Context<G3AuthEnv>, "get">, key: string): boolean {
  if (c.get("sessionType") === "pin") return false;
  if (c.get("userIsAdmin")) return true;
  const definitions = c.get("permissionDefinitions") ?? [];
  const definition = definitions.find((permission) => permission.key === key);
  if (!definition) return false;
  if (c.get("userIsMentor") && definition.roles.includes("mentor")) return true;
  const assigned = c.get("userPermissions") ?? [];
  return (
    assigned.includes(key) ||
    definitions.some(
      (permission) => assigned.includes(permission.key) && permission.includes?.includes(key),
    )
  );
}

export const requirePermission = (key: string): MiddlewareHandler<G3AuthEnv> =>
  createMiddleware<G3AuthEnv>(async (c, next) => {
    if (!(await loadUser(c, false))) return unauthorized(c);
    if (!hasPermission(c, key)) return c.json({ error: "You do not have this permission." }, 403);
    await next();
  });

/** Mentor access or trusted student access in this app (403 otherwise). */
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
