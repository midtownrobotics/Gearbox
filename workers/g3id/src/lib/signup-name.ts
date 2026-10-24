import { and, eq, inArray } from "drizzle-orm";
import { createDb } from "../db";
import { coreUserIdentities, coreUsers } from "../db/schema";
import type { AppEnv } from "../types";
import { CHAT_LABELS, type ChatProvider } from "./chat";
import { dmAdmins } from "./member-dm";
import { teamUrl } from "./team";

// Someone new who signs up with Slack or Discord enters their full name before their team's
// admins are asked to approve them: chat names are often nicknames. The sign-in page they came
// from gets a one-time token for that step (good for a day), spent at POST /auth/signup/name.

type Env = AppEnv["Bindings"];

/** The longest name a member can have. */
export const NAME_MAX = 80;

/** A name as entered, trimmed and with runs of spaces made one; null when it isn't one. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= NAME_MAX ? name : null;
}

const key = (token: string) => `signup_name:${token}`;

/** A token for the person's name step, or null when they don't need one. */
export async function nameToken(env: Env, userId: string): Promise<string | null> {
  const user = await createDb(env.DB)
    .select({ status: coreUsers.status, needsName: coreUsers.needsName })
    .from(coreUsers)
    .where(eq(coreUsers.id, userId))
    .get();
  if (user?.status !== "pending" || user.needsName !== 1) return null;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await env.RATE_LIMIT.put(key(token), userId, { expirationTtl: 86400 });
  return token;
}

/** The person a name token is for, while they still need a name; null otherwise. */
export async function nameTokenUser(env: Env, token: string) {
  const userId = token ? await env.RATE_LIMIT.get(key(token)) : null;
  if (!userId) return null;
  const user = await createDb(env.DB)
    .select({
      id: coreUsers.id,
      teamId: coreUsers.teamId,
      email: coreUsers.email,
      username: coreUsers.username,
      displayName: coreUsers.displayName,
      status: coreUsers.status,
      needsName: coreUsers.needsName,
    })
    .from(coreUsers)
    .where(eq(coreUsers.id, userId))
    .get();
  return user?.status === "pending" && user.needsName === 1 ? user : null;
}

/**
 * Saves the person's name, spends the token and tells the team's admins there's someone to
 * approve. Never fails for a DM that doesn't go.
 */
export async function saveSignupName(
  env: Env,
  token: string,
  name: string,
): Promise<"saved" | "expired"> {
  const user = await nameTokenUser(env, token);
  if (!user) return "expired";
  const db = createDb(env.DB);
  const saved = await db
    .update(coreUsers)
    .set({ displayName: name, needsName: 0, updatedAt: Math.floor(Date.now() / 1000) })
    .where(and(eq(coreUsers.id, user.id), eq(coreUsers.needsName, 1)))
    .returning({ id: coreUsers.id });
  await env.RATE_LIMIT.delete(key(token));
  // Two tabs racing: only the first save tells the admins.
  if (saved.length === 0) return "expired";

  const chat = await db
    .select({ provider: coreUserIdentities.provider })
    .from(coreUserIdentities)
    .where(
      and(
        eq(coreUserIdentities.userId, user.id),
        inArray(coreUserIdentities.provider, ["slack", "discord"]),
      ),
    )
    .get();
  const username =
    user.username && user.username !== name && chat
      ? `, ${user.username} on ${CHAT_LABELS[chat.provider as ChatProvider]}`
      : "";
  try {
    await dmAdmins(
      env,
      user.teamId,
      `👋 ${name} (${user.email}${username}) signed up and is waiting for approval: ${teamUrl(env, user.teamId, "portal")}/admin/members/${user.id}`,
    );
  } catch (err) {
    console.error("[signup] telling admins about a sign-up failed", err);
  }
  return "saved";
}
