import { getUserInfo } from "@g3/slack";
import { and, eq } from "drizzle-orm";
import { createDb } from "../db";
import { coreSlackLinkCodes, coreUserIdentities, coreUsers } from "../db/schema";
import type { AppEnv } from "../types";
import { newId } from "./id";
import { createSession } from "./session";
import { slackForTeam, teamForWorkspace } from "./slack-install";
import { teamUrl } from "./team";
import { teamIdName } from "./team-ui";

export function generateCode(): string {
  return (crypto.getRandomValues(new Uint32Array(1))[0] % 10000).toString().padStart(4, "0");
}

export function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A code someone sends to the team's Slack bot to sign in (or, for a team with no members yet, to
 * become its first admin), and the token their page polls with. Valid for 15 minutes.
 */
export async function createSigninCode(
  db: ReturnType<typeof createDb>,
  teamId: string,
  redirect: string | null,
): Promise<{ code: string; token: string }> {
  const code = generateCode();
  const token = generateToken();
  const now = Math.floor(Date.now() / 1000);
  await db.insert(coreSlackLinkCodes).values({
    id: newId(),
    teamId,
    userId: null,
    code,
    type: "signin",
    pollingToken: token,
    redirectUrl: redirect,
    expiresAt: now + 900,
    used: 0,
    createdAt: now,
  });
  return { code, token };
}

type HandleResult = {
  success: boolean;
  message: string;
  token?: string | null;
  redirectUrl?: string | null;
};

export async function handleSlackCode(opts: {
  code: string;
  slackUserId: string;
  workspaceId: string;
  type: "signin" | "link";
  env: AppEnv["Bindings"];
}): Promise<HandleResult> {
  const { code, slackUserId, workspaceId, type, env } = opts;

  // The team whose Slack this came from; a code only works from its own team's workspace.
  const workspaceTeam = await teamForWorkspace(env, workspaceId);
  if (!workspaceTeam) {
    return { success: false, message: "This Slack workspace isn't connected to a team." };
  }

  // Rate limit: 5 attempts per 15 minutes per Slack user
  const rateLimitKey = `rate_limit:slack:${slackUserId}`;
  const rateRaw = await env.RATE_LIMIT.get(rateLimitKey);
  const now = Math.floor(Date.now() / 1000);

  let attempts = 0;
  let firstAt = now;
  if (rateRaw) {
    const parsed = JSON.parse(rateRaw) as { count: number; firstAt: number };
    if (now - parsed.firstAt < 900) {
      attempts = parsed.count;
      firstAt = parsed.firstAt;
    }
  }

  if (attempts >= 5) {
    return {
      success: false,
      message: "❌ Too many attempts. Please wait 15 minutes and try again.",
    };
  }

  await env.RATE_LIMIT.put(rateLimitKey, JSON.stringify({ count: attempts + 1, firstAt }), {
    expirationTtl: 900,
  });

  const db = createDb(env.DB);

  const record = await db
    .select()
    .from(coreSlackLinkCodes)
    .where(and(eq(coreSlackLinkCodes.code, code), eq(coreSlackLinkCodes.type, type)))
    .get();

  if (!record || record.used || record.expiresAt < now) {
    return { success: false, message: "❌ Invalid or expired code. Please try again." };
  }
  if (record.teamId !== workspaceTeam) {
    return {
      success: false,
      message: "❌ This code is for another team. Send it in your own team's Slack.",
    };
  }

  // Mark used immediately to prevent races
  await db.update(coreSlackLinkCodes).set({ used: 1 }).where(eq(coreSlackLinkCodes.id, record.id));

  const updateStatus = async (status: string, message?: string, sessionId?: string) => {
    await db
      .update(coreSlackLinkCodes)
      .set({
        status: status as "pending" | "success" | "failed" | "linked" | "signup_pending",
        statusMessage: message,
        sessionId,
      })
      .where(eq(coreSlackLinkCodes.id, record.id));
  };

  // --- Link flow ---
  if (type === "link") {
    const idName = await teamIdName(db, record.teamId);
    const userId = record.userId;
    if (!userId) {
      await updateStatus("failed", "Invalid code.");
      return { success: false, message: "❌ Invalid code." };
    }

    const existingIdentity = await db
      .select({ userId: coreUserIdentities.userId })
      .from(coreUserIdentities)
      .where(
        and(
          eq(coreUserIdentities.provider, "slack"),
          eq(coreUserIdentities.providerId, slackUserId),
        ),
      )
      .get();

    if (existingIdentity) {
      if (existingIdentity.userId === userId) {
        await updateStatus("linked");
        return {
          success: true,
          message: `✅ Your Slack account is already linked to your ${idName}.`,
        };
      }
      const msg = `This Slack account is already linked to a different ${idName} account.`;
      await updateStatus("failed", msg);
      return { success: false, message: `❌ ${msg}` };
    }

    const ts = Math.floor(Date.now() / 1000);
    await db.insert(coreUserIdentities).values({
      id: newId(),
      userId,
      provider: "slack",
      providerId: slackUserId,
      createdAt: ts,
      updatedAt: ts,
    });

    await updateStatus("linked");
    return { success: true, message: `✅ Slack account linked successfully to your ${idName}.` };
  }

  // --- Sign-in / sign-up flow ---
  const identity = await db
    .select({ userId: coreUserIdentities.userId })
    .from(coreUserIdentities)
    .where(
      and(eq(coreUserIdentities.provider, "slack"), eq(coreUserIdentities.providerId, slackUserId)),
    )
    .get();

  if (identity) {
    const user = await db
      .select({ id: coreUsers.id, teamId: coreUsers.teamId, status: coreUsers.status })
      .from(coreUsers)
      .where(eq(coreUsers.id, identity.userId))
      .get();

    if (user && user.teamId !== record.teamId) {
      const msg = "This account belongs to another team. Sign in on your own team's page.";
      await updateStatus("failed", msg);
      return { success: false, message: `❌ ${msg}` };
    }

    if (!user || user.status !== "active") {
      const msg =
        user?.status === "pending"
          ? "Your account is awaiting admin approval."
          : "Your account is not active.";
      await updateStatus("failed", msg);
      return { success: false, message: `❌ ${msg}` };
    }

    const sessionId = await createSession(user.id, env);
    await updateStatus("success", undefined, sessionId);
    return {
      success: true,
      token: record.pollingToken,
      redirectUrl: record.redirectUrl,
      message: "✅ Signed in successfully.",
    };
  }

  // No Slack identity found — attempt sign-up
  const teamSlack = await slackForTeam(env, workspaceTeam);
  const slackUser = teamSlack
    ? await getUserInfo(slackUserId, teamSlack.slack)
    : { email: null, displayName: "Unknown" };

  if (!slackUser.email) {
    const msg = `Your Slack account has no email. Please sign up at ${new URL(teamUrl(env, record.teamId, "id")).host} with email first, then link Slack from your account settings.`;
    await updateStatus("failed", msg);
    return { success: false, message: `❌ ${msg}` };
  }

  const email = slackUser.email.toLowerCase();

  const existingUser = await db
    .select({ id: coreUsers.id })
    .from(coreUsers)
    .where(eq(coreUsers.email, email))
    .get();

  if (existingUser) {
    const msg =
      "An account with your email already exists. Sign in with your existing method and link Slack from your account settings.";
    await updateStatus("failed", msg);
    return { success: false, message: `❌ ${msg}` };
  }

  // A team's first member is the person who signed it up (the platform's sign-up ends with this
  // code): they start active, as its admin. Everyone after them waits for an admin's approval.
  const firstMember = !(await db
    .select({ id: coreUsers.id })
    .from(coreUsers)
    .where(eq(coreUsers.teamId, record.teamId))
    .limit(1)
    .get());

  const ts = Math.floor(Date.now() / 1000);
  const userId = newId();
  await db.batch([
    db.insert(coreUsers).values({
      id: userId,
      teamId: record.teamId,
      email,
      displayName: slackUser.displayName,
      status: firstMember ? "active" : "pending",
      isAdmin: firstMember ? 1 : 0,
      createdAt: ts,
      updatedAt: ts,
    }),
    db.insert(coreUserIdentities).values({
      id: newId(),
      userId,
      provider: "slack",
      providerId: slackUserId,
      createdAt: ts,
      updatedAt: ts,
    }),
  ]);

  if (firstMember) {
    const sessionId = await createSession(userId, env);
    await db.update(coreSlackLinkCodes).set({ userId }).where(eq(coreSlackLinkCodes.id, record.id));
    await updateStatus("success", undefined, sessionId);
    return {
      success: true,
      token: record.pollingToken,
      redirectUrl: record.redirectUrl,
      message: "✅ Your team is set up, and you're its first admin.",
    };
  }

  await updateStatus("signup_pending");
  return { success: true, message: "✅ Account created! Your account is pending admin approval." };
}
