import { signInCallbackApiUrl, teamAppUrl, teamKey } from "@g3/site-config";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { Db } from "../db";
import { coreUsers } from "../db/schema";
import type { AppEnv } from "../types";

// Which team a request is for. Each team signs in on its own G3ID address, <number>-id.<domain>;
// the gateway reads the team from the hostname and passes it as X-Team-Id (removing any a client
// sent). Without it (local dev, tests, G3's own addresses) it's the team in site.ts.

/** The team this request is for. */
export function requestTeamId(c: Context<AppEnv>): string {
  return c.req.header("X-Team-Id") ?? teamKey;
}

/** The team in site.ts. */
export const siteTeamId = teamKey;

/** A team's G3ID page, where its members sign in: FRONTEND_URL for the site's team. */
export function teamFrontend(env: AppEnv["Bindings"], teamId: string): string {
  return teamId === teamKey ? env.FRONTEND_URL : teamAppUrl(teamId, "id");
}

/**
 * Where a sign-in provider sends a team's members back: id.<domain> for the site's team (its
 * `*_REDIRECT_URI` setting, localhost in dev), id.<platform domain> for every other team, so the
 * session cookie is set on the team's own domain. Each must be registered with the provider.
 */
export function providerRedirectUri(
  env: AppEnv["Bindings"],
  provider: "google" | "github" | "steam" | "onshape",
  teamId: string,
): string {
  if (teamId === teamKey) {
    const settings = {
      google: env.GOOGLE_REDIRECT_URI,
      github: env.GITHUB_REDIRECT_URI,
      steam: env.STEAM_REDIRECT_URI,
      onshape: env.ONSHAPE_REDIRECT_URI,
    };
    return settings[provider];
  }
  return `${signInCallbackApiUrl(teamId)}/auth/${provider}/callback`;
}

/** The team a user belongs to. */
export async function teamOfUser(db: Db, userId: string): Promise<string> {
  const user = await db
    .select({ teamId: coreUsers.teamId })
    .from(coreUsers)
    .where(eq(coreUsers.id, userId))
    .get();
  if (!user) throw new Error(`No user ${userId}.`);
  return user.teamId;
}
