import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { teams } from "../db/schema";
import { requestTeamId } from "../lib/team";
import type { AppEnv } from "../types";

// Public facts about a team. The gateway asks here whether a <number>-<app> hostname's team
// exists; the sign-in page asks which team it's for.

const findTeam = (env: AppEnv["Bindings"], id: string) =>
  createDb(env.DB)
    .select({ id: teams.id, teamNumber: teams.teamNumber, name: teams.name })
    .from(teams)
    .where(eq(teams.id, id))
    .get();

export const teamsRouter = new Hono<AppEnv>()
  // The team this address is for (the gateway's X-Team-Id).
  .get("/current", async (c) => {
    const team = await findTeam(c.env, requestTeamId(c));
    if (!team) return c.json({ error: "No such team." }, 404);
    return c.json(team);
  })
  .get("/:id", async (c) => {
    const team = await findTeam(c.env, c.req.param("id"));
    if (!team) return c.json({ error: "No such team." }, 404);
    return c.json(team);
  });
