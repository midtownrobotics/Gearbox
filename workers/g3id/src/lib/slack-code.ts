import { appUrl, idName } from "@g3/site-config";
import { getUserInfo } from "@g3/slack";
import { and, eq } from "drizzle-orm";
import { createDb } from "../db";
import { coreSlackLinkCodes, coreUserIdentities, coreUsers } from "../db/schema";
import type { AppEnv } from "../types";
import { newId } from "./id";
import { createSession } from "./session";

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

  if (workspaceId !== env.SLACK_TEAM_ID) {
    return { success: false, message: "This Slack workspace is not authorized." };
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
      .select({ id: coreUsers.id, status: coreUsers.status })
      .from(coreUsers)
      .where(eq(coreUsers.id, identity.userId))
      .get();

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
  const slackUser = await getUserInfo(slackUserId, env);

  if (!slackUser.email) {
    const msg = `Your Slack account has no email. Please sign up at ${new URL(appUrl("id")).host} with email first, then link Slack from your account settings.`;
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

  const ts = Math.floor(Date.now() / 1000);
  const userId = newId();
  await db.batch([
    db.insert(coreUsers).values({
      id: userId,
      email,
      displayName: slackUser.displayName,
      status: "pending",
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

  await updateStatus("signup_pending");
  return { success: true, message: "✅ Account created! Your account is pending admin approval." };
}
