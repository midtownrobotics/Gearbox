import { activeMembers, inTeam, logTeamChange, requireIdentityAdmin, withTeam } from "@g3/auth";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createOrdersDb } from "../db";
import { appUsers } from "../db/schema";
import type { AppEnv } from "../types";

const trustedValidator = validator("json", (value, c): { trusted: boolean } => {
  const trusted = (value as { trusted?: unknown })?.trusted;
  if (typeof trusted !== "boolean") {
    return c.json({ error: "trusted must be true or false." }, 400) as never;
  }
  return { trusted };
});

/**
 * Catalog editor grants, managed by ID's trusted students from its central permissions page.
 */
export const trustedRouter = new Hono<AppEnv>()
  .get("/", requireIdentityAdmin, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const rows = await db
      .select()
      .from(appUsers)
      .where(inTeam(appUsers, c.get("teamId")))
      .orderBy(asc(appUsers.name))
      .all();
    return c.json(rows.map((u) => ({ ...u, trusted: u.trusted === 1 })));
  })
  .put("/:id", requireIdentityAdmin, trustedValidator, async (c) => {
    const body = c.req.valid("json");
    const db = createOrdersDb(c.env.ORDERS_DB);
    const members = await activeMembers(c.env, c.get("teamId"));
    if (!members) return c.json({ error: "Could not load the team's members." }, 502);
    const member = members.find((person) => person.id === c.req.param("id"));
    if (!member) return c.json({ error: "Active member not found." }, 404);
    await db
      .insert(appUsers)
      .values(withTeam(c.get("teamId"), { id: member.id, name: member.displayName, lastSeenAt: 0 }))
      .onConflictDoNothing();
    const row = await db
      .update(appUsers)
      .set(
        body.trusted
          ? { trusted: 1, trustedBy: c.get("userDisplayName"), trustedAt: Date.now() }
          : { trusted: 0, trustedBy: null, trustedAt: null },
      )
      .where(inTeam(appUsers, c.get("teamId"), eq(appUsers.id, c.req.param("id"))))
      .returning()
      .get();
    if (!row) return c.json({ error: "That person hasn't opened Orders yet." }, 404);
    await logTeamChange(c.env, c.get("teamId"), {
      userId: c.get("userId"),
      app: "orders",
      what: `Catalog permission for ${member.displayName}`,
      changed: ["Edit catalog"],
    });
    return c.json({ ...row, trusted: row.trusted === 1 });
  });
