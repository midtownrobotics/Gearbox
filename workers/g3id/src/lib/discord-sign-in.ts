import { type DiscordUser, isGuildMember } from "@g3/discord";
import { and, eq } from "drizzle-orm";
import { createDb } from "../db";
import { coreUserIdentities, coreUsers } from "../db/schema";
import type { AppEnv } from "../types";
import { discordForTeam } from "./discord-install";
import { newId } from "./id";
import { dmAdmins } from "./member-dm";
import { createSession } from "./session";
import { teamUrl } from "./team";

// Signing in with Discord (OAuth, routes/auth/discord.ts), the Discord counterpart of the Slack
// code flow in slack-code.ts: an existing member is signed in; someone new who is in the team's
// Discord server signs up, as its first admin if the team has no members yet (the founder) or
// waiting for an admin's approval otherwise.

type Env = AppEnv["Bindings"];

export type DiscordSignIn =
  | { result: "signed_in"; userId: string; sessionId: string; firstAdmin: boolean }
  | { result: "pending" }
  | { result: "failed"; message: string };

export async function signInWithDiscord(
  env: Env,
  teamId: string,
  person: DiscordUser,
): Promise<DiscordSignIn> {
  const db = createDb(env.DB);
  const identity = await db
    .select({ userId: coreUserIdentities.userId })
    .from(coreUserIdentities)
    .where(
      and(eq(coreUserIdentities.provider, "discord"), eq(coreUserIdentities.providerId, person.id)),
    )
    .get();

  if (identity) {
    const user = await db
      .select({ id: coreUsers.id, teamId: coreUsers.teamId, status: coreUsers.status })
      .from(coreUsers)
      .where(eq(coreUsers.id, identity.userId))
      .get();
    if (user && user.teamId !== teamId) {
      return {
        result: "failed",
        message: "This account belongs to another team. Sign in on your own team's page.",
      };
    }
    if (user?.status === "pending") return { result: "pending" };
    if (!user || user.status !== "active") {
      return { result: "failed", message: "Your account is not active." };
    }
    return {
      result: "signed_in",
      userId: user.id,
      sessionId: await createSession(user.id, env),
      firstAdmin: false,
    };
  }

  // Someone new: only the team's own Discord server's members sign up.
  const teamDiscord = await discordForTeam(env, teamId);
  if (!teamDiscord || !env.DISCORD_BOT_TOKEN) {
    return {
      result: "failed",
      message:
        "No account found with this Discord account. Your team doesn't use Discord, so sign in another way.",
    };
  }
  const member = await isGuildMember(
    { DISCORD_BOT_TOKEN: env.DISCORD_BOT_TOKEN },
    teamDiscord.guildId,
    person.id,
  );
  if (!member) {
    return {
      result: "failed",
      message: "Join your team's Discord server first, then sign in with Discord again.",
    };
  }
  if (!person.email) {
    return {
      result: "failed",
      message:
        "Your Discord account has no verified email. Verify your email in Discord's settings, then try again.",
    };
  }
  const email = person.email.toLowerCase();
  const existing = await db
    .select({ id: coreUsers.id })
    .from(coreUsers)
    .where(eq(coreUsers.email, email))
    .get();
  if (existing) {
    return {
      result: "failed",
      message:
        "An account with your email already exists. Sign in with your existing method and link Discord from your account page.",
    };
  }

  // The team's first member is its founder: active, as its admin. Everyone after waits.
  const firstMember = !(await db
    .select({ id: coreUsers.id })
    .from(coreUsers)
    .where(eq(coreUsers.teamId, teamId))
    .limit(1)
    .get());
  const now = Math.floor(Date.now() / 1000);
  const userId = newId();
  await db.batch([
    db.insert(coreUsers).values({
      id: userId,
      teamId,
      email,
      displayName: person.displayName,
      status: firstMember ? "active" : "pending",
      isAdmin: firstMember ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(coreUserIdentities).values({
      id: newId(),
      userId,
      provider: "discord",
      providerId: person.id,
      providerEmail: email,
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  if (firstMember) {
    return {
      result: "signed_in",
      userId,
      sessionId: await createSession(userId, env),
      firstAdmin: true,
    };
  }
  // Every admin hears there's someone to approve. Never fails the sign-up.
  try {
    await dmAdmins(
      env,
      teamId,
      `👋 ${person.displayName} (${email}) signed up and is waiting for approval: ${teamUrl(env, teamId, "portal")}/admin/members/${userId}`,
    );
  } catch (err) {
    console.error("[discord] telling admins about a sign-up failed", err);
  }
  return { result: "pending" };
}
