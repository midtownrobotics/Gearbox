import { Hono } from "hono";
import { NAME_MAX, cleanName, nameTokenUser, saveSignupName } from "../../lib/signup-name";
import { requestTeamId } from "../../lib/team";
import type { AppEnv } from "../../types";

// The name step of a Slack or Discord sign-up (lib/signup-name.ts): the sign-in page asks for the
// person's full name, starting from their chat name, before their team's admins hear of them.

const EXPIRED = "This link has expired or was already used. Sign in again to carry on.";

export const signupNameRouter = new Hono<AppEnv>()
  .get("/signup/name", async (c) => {
    const user = await nameTokenUser(c.env, c.req.query("token") ?? "");
    if (!user || user.teamId !== requestTeamId(c)) return c.json({ error: EXPIRED }, 404);
    return c.json({ username: user.username ?? user.displayName });
  })
  .post("/signup/name", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      token?: unknown;
      name?: unknown;
    } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const name = cleanName(body?.name);
    if (!name) return c.json({ error: `Enter a name of up to ${NAME_MAX} characters.` }, 400);
    const user = await nameTokenUser(c.env, token);
    if (!user || user.teamId !== requestTeamId(c)) return c.json({ error: EXPIRED }, 404);
    if ((await saveSignupName(c.env, token, name)) !== "saved") {
      return c.json({ error: EXPIRED }, 404);
    }
    return c.json({ ok: true });
  });
