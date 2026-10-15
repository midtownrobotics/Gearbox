import { activeMembers, inTeam, requireAuth, withTeam } from "@g3/auth";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { friends } from "../db/schema";
import { nowSeconds } from "../lib/input";
import type { AppEnv } from "../types";

// Each person's friends: members they want beside them on schedules. Private: every route is
// about the signed-in person's own list, and nothing anywhere says who added whom (a friend isn't
// told; the team's data download leaves it out). Anyone signed in, kiosk sessions too: it's their
// own list.

const membersUnavailable = { error: "Couldn't load the team's members. Try again." } as const;

export const friendsRouter = new Hono<AppEnv>()
  .use("*", requireAuth)
  // The signed-in person's friends who are still on the team.
  .get("/", async (c) => {
    const team = c.get("teamId");
    const [rows, members] = await Promise.all([
      createDb(c.env.SCHEDULE_DB)
        .select({ friendId: friends.friendId })
        .from(friends)
        .where(inTeam(friends, team, eq(friends.userId, c.get("userId"))))
        .orderBy(asc(friends.addedAt))
        .all(),
      activeMembers(c.env, team),
    ]);
    if (!members) return c.json(membersUnavailable, 503);
    const names = new Map(members.map((m) => [m.id, m.displayName]));
    return c.json(
      rows
        .filter((row) => names.has(row.friendId))
        .map((row) => ({ userId: row.friendId, displayName: names.get(row.friendId) as string })),
    );
  })
  // Everyone else on the team, to search for friends: names only.
  .get("/people", async (c) => {
    const members = await activeMembers(c.env, c.get("teamId"));
    if (!members) return c.json(membersUnavailable, 503);
    return c.json(
      members
        .filter((m) => m.id !== c.get("userId"))
        .map(({ id, displayName }) => ({ id, displayName })),
    );
  })
  .put("/:userId", async (c) => {
    const team = c.get("teamId");
    const friendId = c.req.param("userId");
    if (friendId === c.get("userId")) {
      return c.json({ error: "You can't add yourself as a friend." }, 400);
    }
    const members = await activeMembers(c.env, team);
    if (!members) return c.json(membersUnavailable, 503);
    if (!members.some((m) => m.id === friendId)) {
      return c.json({ error: "Only the team's members can be friends." }, 400);
    }
    await createDb(c.env.SCHEDULE_DB)
      .insert(friends)
      .values(withTeam(team, { userId: c.get("userId"), friendId, addedAt: nowSeconds() }))
      .onConflictDoNothing();
    return c.json({ ok: true });
  })
  .delete("/:userId", async (c) => {
    await createDb(c.env.SCHEDULE_DB)
      .delete(friends)
      .where(
        inTeam(
          friends,
          c.get("teamId"),
          eq(friends.userId, c.get("userId")),
          eq(friends.friendId, c.req.param("userId")),
        ),
      );
    return c.json({ ok: true });
  });
