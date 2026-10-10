import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { coreUserIdentities, coreUsers } from "../db/schema";
import {
  METHOD_LABELS,
  OPTIONAL_METHODS,
  type OptionalMethod,
  saveSignInMethods,
  signInMethods,
} from "../lib/sign-in-methods";
import { requestTeamId, teamOfUser } from "../lib/team";
import { logToTeam } from "../lib/team-log";
import { requireAdmin } from "../middleware/auth";
import type { AppEnv } from "../types";

// The sign-in methods a team allows (lib/sign-in-methods.ts). The sign-in page and the account
// page read them for the team the address is for; the team's admins change them on the Sign-in
// page of the team's admin pages (through /api/~id).

type Db = ReturnType<typeof createDb>;

/** For each method that can be switched off: how many active members have only it to sign in with. */
async function onlyWith(db: Db, teamId: string): Promise<Record<OptionalMethod, number>> {
  const rows = await db
    .select({ userId: coreUserIdentities.userId, provider: coreUserIdentities.provider })
    .from(coreUserIdentities)
    .innerJoin(coreUsers, eq(coreUsers.id, coreUserIdentities.userId))
    .where(and(eq(coreUsers.teamId, teamId), eq(coreUsers.status, "active")))
    .all();
  const byUser = new Map<string, Set<string>>();
  for (const r of rows) byUser.set(r.userId, (byUser.get(r.userId) ?? new Set()).add(r.provider));
  const counts = { google: 0, github: 0, steam: 0, pin: 0 };
  for (const providers of byUser.values()) {
    const ways = [...providers].filter((p) => p === "slack" || p in counts);
    if (ways.length === 1 && ways[0] !== "slack") counts[ways[0] as OptionalMethod]++;
  }
  return counts;
}

export const teamSignInRouter = new Hono<AppEnv>()
  // The team's methods, for the sign-in page (public, like its name and colors).
  .get("/", async (c) => {
    c.header("Cache-Control", "public, max-age=60");
    return c.json(await signInMethods(createDb(c.env.DB), requestTeamId(c)));
  });

export const adminSignInRouter = new Hono<AppEnv>()
  .use("*", requireAdmin)
  .get("/", async (c) => {
    const db = createDb(c.env.DB);
    const team = await teamOfUser(db, c.get("userId") as string);
    const [methods, only] = await Promise.all([signInMethods(db, team), onlyWith(db, team)]);
    return c.json({ methods, onlyWith: only });
  })
  .put("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const next = {} as Record<OptionalMethod, boolean>;
    for (const m of OPTIONAL_METHODS) {
      if (typeof body?.[m] !== "boolean") return c.json({ error: "Say on or off for each." }, 400);
      next[m] = body[m] as boolean;
    }
    const db = createDb(c.env.DB);
    const userId = c.get("userId") as string;
    const team = await teamOfUser(db, userId);

    // An admin who can only sign in with a method they're switching off would be locked out.
    const mine = await db
      .select({ provider: coreUserIdentities.provider })
      .from(coreUserIdentities)
      .where(
        and(
          eq(coreUserIdentities.userId, userId),
          inArray(coreUserIdentities.provider, ["slack", "google", "github", "steam"]),
        ),
      )
      .all();
    const stillIn = mine.some(
      (i) => i.provider === "slack" || next[i.provider as OptionalMethod] === true,
    );
    if (mine.length > 0 && !stillIn) {
      return c.json(
        { error: "You couldn't sign in again. Link Slack to your account first." },
        400,
      );
    }

    const before = await signInMethods(db, team);
    await saveSignInMethods(db, team, next, userId);
    const changed = OPTIONAL_METHODS.filter((m) => before[m] !== next[m]).map(
      (m) => `${METHOD_LABELS[m]} ${next[m] ? "on" : "off"}`,
    );
    if (changed.length > 0) {
      await logToTeam(c.env, team, { userId, app: "id", what: "Sign-in methods", changed });
    }
    return c.json({ methods: await signInMethods(db, team), onlyWith: await onlyWith(db, team) });
  });
