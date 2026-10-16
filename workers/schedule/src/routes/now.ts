import { requireAuth } from "@g3/auth";
import { Hono } from "hono";
import { createDb } from "../db";
import { peopleNow } from "../lib/now";
import { ROLE_TYPES, isRoleType } from "../lib/roles";
import type { AppEnv } from "../types";

// Who has a role of a type right now (`?type=pit`), for other apps' pages: Pit's "In the pit
// now". Anyone signed in, kiosk sessions too: only published schedules count.

export const nowRouter = new Hono<AppEnv>().get("/", requireAuth, async (c) => {
  const type = c.req.query("type");
  if (!isRoleType(type)) {
    return c.json({ error: `type must be one of: ${ROLE_TYPES.join(", ")}.` }, 400);
  }
  const people = await peopleNow(c.env, createDb(c.env.SCHEDULE_DB), c.get("teamId"), type);
  return c.json({ people });
});
