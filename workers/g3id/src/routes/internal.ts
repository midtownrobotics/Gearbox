import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { coreSlackLinkCodes, teams } from "../db/schema";
import { createSigninCode } from "../lib/slack-code";
import { saveInstallation } from "../lib/slack-install";
import type { AppEnv } from "../types";

// For other workers only, over service bindings: the platform worker signs teams up through these.
// The gateway never answers /api/internal, and production workers have no other public address.

type NewTeam = { id: string; teamNumber: number; name: string };

type NewInstallation = {
  teamId: string;
  workspaceId: string;
  workspaceName: string | null;
  botUserId: string | null;
  botToken: string;
};

export const internalRouter = new Hono<AppEnv>()
  // A team the platform signed up. The platform keeps the team's record; G3ID keeps its id, number
  // and name, which its own tables (users, kiosks, Slack) point at.
  .put("/teams", async (c) => {
    const team = await c.req.json<NewTeam>();
    const now = Math.floor(Date.now() / 1000);
    await createDb(c.env.DB)
      .insert(teams)
      .values({ ...team, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: teams.id, set: { name: team.name, updatedAt: now } });
    return c.json({ ok: true });
  })
  // The team's Slack workspace, from the sign-up's "Add to Slack".
  .post("/slack-installations", async (c) => {
    const install = await c.req.json<NewInstallation>();
    const result = await saveInstallation(c.env, { ...install, installedBy: null });
    return c.json({ result }, result === "saved" ? 200 : 409);
  })
  // The code the founder sends to the bot: the team has no members yet, so whoever sends it from
  // the team's workspace becomes its first admin (lib/slack-code.ts).
  .post("/signup-codes", async (c) => {
    const { teamId, redirect } = await c.req.json<{ teamId: string; redirect: string | null }>();
    return c.json(await createSigninCode(createDb(c.env.DB), teamId, redirect));
  })
  .get("/signup-codes/:token", async (c) => {
    const code = await createDb(c.env.DB)
      .select({
        status: coreSlackLinkCodes.status,
        message: coreSlackLinkCodes.statusMessage,
        userId: coreSlackLinkCodes.userId,
        expiresAt: coreSlackLinkCodes.expiresAt,
      })
      .from(coreSlackLinkCodes)
      .where(eq(coreSlackLinkCodes.pollingToken, c.req.param("token")))
      .get();
    if (!code) return c.json({ status: "expired" });
    if (code.status === "pending" && code.expiresAt < Math.floor(Date.now() / 1000)) {
      return c.json({ status: "expired" });
    }
    return c.json(code);
  });
