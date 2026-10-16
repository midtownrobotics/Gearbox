import { eq } from "drizzle-orm";
import { createDb } from "../db";
import { coreSessions, coreUsers } from "../db/schema";
import type { AppEnv } from "../types";
import { newId } from "./id";

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

/** A new session for a user, lasting `ttl` seconds (7 days unless said). */
export async function createSession(
  userId: string,
  env: AppEnv["Bindings"],
  ttl = SESSION_TTL,
): Promise<string> {
  const db = createDb(env.DB);
  const sessionId = newId();
  const now = Math.floor(Date.now() / 1000);

  await Promise.all([
    db.insert(coreSessions).values({
      id: sessionId,
      userId,
      expiresAt: now + ttl,
      createdAt: now,
    }),
    db.update(coreUsers).set({ lastLoginAt: now }).where(eq(coreUsers.id, userId)),
    env.SESSIONS.put(`session:${sessionId}`, userId, { expirationTtl: ttl }),
  ]);

  return sessionId;
}

export async function deleteSession(sessionId: string, env: AppEnv["Bindings"]): Promise<void> {
  const db = createDb(env.DB);
  await Promise.all([
    db.delete(coreSessions).where(eq(coreSessions.id, sessionId)),
    env.SESSIONS.delete(`session:${sessionId}`),
    env.SESSIONS.delete(`session:${sessionId}:meta`),
  ]);
}

/** Whether the session was made by PIN sign-in on a kiosk (recorded in its KV metadata). */
export async function isPinSession(
  sessionId: string | undefined,
  env: AppEnv["Bindings"],
): Promise<boolean> {
  if (!sessionId) return false;
  const meta = await env.SESSIONS.get(`session:${sessionId}:meta`);
  if (!meta) return false;
  try {
    return (JSON.parse(meta) as { sessionType?: string }).sessionType === "pin";
  } catch {
    return false;
  }
}
