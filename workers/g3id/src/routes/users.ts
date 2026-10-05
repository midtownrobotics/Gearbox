import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { coreUserIdentities, coreUserPins, coreUsers } from "../db/schema";
import { teamOfUser } from "../lib/team";
import { requireAdmin, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export type BasicUserInfo = {
  id: string;
  email: string;
  displayName: string;
  status: "pending" | "active" | "rejected" | "merged";
  isAdmin: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  slackUserId?: string;
};

export type UserWithPin = BasicUserInfo & {
  pin: string;
};

export const usersRouter = new Hono<AppEnv>()
  .get("/attendance-eligible", requireAuth, async (c) => {
    const db = createDb(c.env.DB);
    const users = await db
      .select({ id: coreUsers.id, displayName: coreUsers.displayName })
      .from(coreUsers)
      .where(and(eq(coreUsers.status, "active"), isNull(coreUsers.deletedAt)))
      .all();
    return c.json({
      users: users.filter((user) => user.displayName.trim().toLowerCase() !== "admin"),
    });
  })
  .get("/", requireAdmin, async (c) => {
    const db = createDb(c.env.DB);

    const users = await db
      .select({
        id: coreUsers.id,
        email: coreUsers.email,
        displayName: coreUsers.displayName,
        status: coreUsers.status,
        isAdmin: coreUsers.isAdmin,
        createdAt: coreUsers.createdAt,
        lastLoginAt: coreUsers.lastLoginAt,
      })
      .from(coreUsers)
      .where(isNull(coreUsers.deletedAt))
      .all();

    const slackIdentities = await db
      .select({ userId: coreUserIdentities.userId, slackUserId: coreUserIdentities.providerId })
      .from(coreUserIdentities)
      .where(eq(coreUserIdentities.provider, "slack"))
      .all();
    const slackIds = new Map(
      slackIdentities.map((identity) => [identity.userId, identity.slackUserId] as const),
    );
    const basicUsers: BasicUserInfo[] = users.map((user) => ({
      ...user,
      isAdmin: user.isAdmin === 1,
      status: user.status as "pending" | "active" | "rejected" | "merged",
      slackUserId: slackIds.get(user.id) ?? undefined,
    }));

    return c.json(basicUsers);
  })
  .get("/by-pin/:pin", requireAuth, async (c) => {
    const pin = c.req.param("pin");
    const db = createDb(c.env.DB);

    // PINs are unique only within a team: look in the caller's.
    const teamId = await teamOfUser(db, c.get("userId") as string);
    const userPin = await db
      .select({ userId: coreUserPins.userId })
      .from(coreUserPins)
      .where(and(eq(coreUserPins.teamId, teamId), eq(coreUserPins.pin, pin)))
      .get();

    if (!userPin) {
      return c.json({ error: "User not found for this PIN." }, 404);
    }

    const user = await db
      .select({
        id: coreUsers.id,
        email: coreUsers.email,
        displayName: coreUsers.displayName,
        status: coreUsers.status,
        isAdmin: coreUsers.isAdmin,
        createdAt: coreUsers.createdAt,
        lastLoginAt: coreUsers.lastLoginAt,
      })
      .from(coreUsers)
      .where(eq(coreUsers.id, userPin.userId))
      .get();

    if (!user) {
      return c.json({ error: "User not found." }, 404);
    }

    const result: UserWithPin = {
      ...user,
      pin,
      isAdmin: user.isAdmin === 1,
      status: user.status as "pending" | "active" | "rejected" | "merged",
    };

    return c.json(result);
  });
