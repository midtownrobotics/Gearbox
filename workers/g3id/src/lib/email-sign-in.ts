// SPDX-License-Identifier: AGPL-3.0-only
import { isDemoTeam, teamLabel } from "@g3/site-config";
import { and, desc, eq, gt, gte, isNull, lt, sql } from "drizzle-orm";
import { createDb } from "../db";
import { emailCodes, emailSends, teamSignInMethods } from "../db/schema";
import type { AppEnv } from "../types";
import { type EmailKind, emailReady, sendEmail } from "./email";
import { newId } from "./id";
import { turnstileReady } from "./open-signup";
import { teamFrontend } from "./team";
import { loadTeamUi } from "./team-ui";

// Email and password sign-in (migration 0026), off unless a team's admins switch it on. Every
// address is checked with a 6-digit code emailed to it before a password works: adding one to an
// account (Portal's Account page), signing up (ID's sign-up page, with sign-up without chat on)
// and resetting a forgotten one. It needs this deployment to send email (lib/email.ts) and
// Turnstile, which guards every form that emails an address someone typed.

type Env = AppEnv["Bindings"];
type Db = ReturnType<typeof createDb>;

export type CodePurpose = "add-password" | "signup" | "reset";

/** A code works for 15 minutes and 5 tries. */
const CODE_SECONDS = 15 * 60;
const CODE_TRIES = 5;
/** Codes an address gets in an hour, and emails a team sends in a day. */
const CODES_PER_HOUR = 5;
const TEAM_EMAILS_PER_DAY = 100;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
const EMAIL_MAX = 254;

/** A typed address, lowercased, or null when it isn't one. */
export function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Why a password can't be used, or null. */
export function passwordProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.length < PASSWORD_MIN) {
    return `Use at least ${PASSWORD_MIN} characters.`;
  }
  if (value.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

/** This deployment can offer it: it sends email and has Turnstile's keys. */
export const emailSignInReady = (env: Env) => emailReady(env) && turnstileReady(env);

/** What the team's admins chose (off without a row), whether or not it can work now. */
export async function emailSignInChosen(db: Db, teamId: string): Promise<boolean> {
  const row = await db
    .select({ on: teamSignInMethods.emailPassword })
    .from(teamSignInMethods)
    .where(eq(teamSignInMethods.teamId, teamId))
    .get();
  return row?.on === 1;
}

export async function saveEmailSignIn(db: Db, teamId: string, on: boolean, userId: string) {
  const values = {
    emailPassword: on ? 1 : 0,
    updatedAt: Math.floor(Date.now() / 1000),
    updatedBy: userId,
  };
  await db
    .insert(teamSignInMethods)
    .values({ teamId, ...values })
    .onConflictDoUpdate({ target: teamSignInMethods.teamId, set: values });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const hashCode = (id: string, code: string) => sha256(`${id}:${code}`);

function newCode(): string {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return String(n % 1_000_000).padStart(6, "0");
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** The team's name for an email: its own name, with its number. */
async function teamName(env: Env, teamId: string): Promise<string> {
  try {
    const { settings } = await loadTeamUi(createDb(env.DB), teamId);
    return settings.name === teamLabel(teamId)
      ? settings.name
      : `${settings.name} (${teamLabel(teamId)})`;
  } catch {
    return teamLabel(teamId);
  }
}

const WHAT: Record<CodePurpose, (team: string) => { subject: string; line: string }> = {
  "add-password": (team) => ({
    subject: "Your code to add a password",
    line: `Enter this code to add a password to your ${team} account on Gearbox.`,
  }),
  signup: (team) => ({
    subject: `Your code to join ${team}`,
    line: `Enter this code to finish signing up for ${team} on Gearbox.`,
  }),
  reset: (team) => ({
    subject: "Your code to reset your password",
    line: `Enter this code to choose a new password for your ${team} account on Gearbox.`,
  }),
};

function codeEmail(purpose: CodePurpose, team: string, code: string) {
  const { subject, line } = WHAT[purpose](team);
  const after = "It works for 15 minutes. If you didn't ask for it, you can ignore this email.";
  return {
    subject: `${subject}: ${code}`,
    text: `${line}\n\n${code}\n\n${after}\n`,
    html: `<p>${escapeHtml(line)}</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p>${escapeHtml(after)}</p>`,
  };
}

export type CodeStart = { ok: true } | { ok: false; error: string; status: 429 | 503 };

const CANT_SEND: CodeStart = {
  ok: false,
  error: "We can't send email right now. Try again later.",
  status: 503,
};

/** Each check that an address or team hasn't been sent too much; null when it may send. */
async function tooMany(db: Db, teamId: string, email: string, now: number) {
  const hourAgo = now - 60 * 60;
  const [mine, team] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(emailCodes)
      .where(
        and(
          eq(emailCodes.teamId, teamId),
          eq(emailCodes.email, email),
          gte(emailCodes.createdAt, hourAgo),
        ),
      )
      .get(),
    db
      .select({ n: sql<number>`coalesce(sum(${emailSends.count}), 0)` })
      .from(emailSends)
      .where(
        and(
          eq(emailSends.teamId, teamId),
          eq(emailSends.day, new Date(now * 1000).toISOString().slice(0, 10)),
        ),
      )
      .get(),
  ]);
  if (Number(mine?.n ?? 0) >= CODES_PER_HOUR) {
    return "Too many codes were sent to this address. Wait an hour and try again.";
  }
  if (Number(team?.n ?? 0) >= TEAM_EMAILS_PER_DAY) {
    return "Your team has sent too many emails today. Try again tomorrow.";
  }
  return null;
}

/**
 * Emails a new code for `purpose` to `email`, replacing any earlier one. `passwordHash` is the
 * password it will set once the code is entered.
 */
export async function sendCode(
  env: Env,
  input: {
    teamId: string;
    purpose: CodePurpose;
    email: string;
    userId?: string | null;
    passwordHash?: string | null;
  },
): Promise<CodeStart> {
  if (!emailReady(env)) return CANT_SEND;
  const db = createDb(env.DB);
  const now = Math.floor(Date.now() / 1000);
  // tenancy: all teams (codes are deleted a day after they're made, whichever team's)
  await db.delete(emailCodes).where(lt(emailCodes.createdAt, now - 24 * 60 * 60));
  const limited = await tooMany(db, input.teamId, input.email, now);
  if (limited) return { ok: false, error: limited, status: 429 };

  const id = newId();
  const code = newCode();
  await db.batch([
    // An earlier code for the same thing stops working.
    db
      .update(emailCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailCodes.teamId, input.teamId),
          eq(emailCodes.email, input.email),
          eq(emailCodes.purpose, input.purpose),
          isNull(emailCodes.usedAt),
        ),
      ),
    db.insert(emailCodes).values({
      id,
      teamId: input.teamId,
      purpose: input.purpose,
      email: input.email,
      userId: input.userId ?? null,
      codeHash: await hashCode(id, code),
      passwordHash: input.passwordHash ?? null,
      expiresAt: now + CODE_SECONDS,
      createdAt: now,
    }),
  ]);
  const message = codeEmail(input.purpose, await teamName(env, input.teamId), code);
  const sent = await sendEmail(env, {
    teamId: input.teamId,
    kind: input.purpose,
    to: input.email,
    ...message,
  });
  if (!sent.ok) {
    await db.delete(emailCodes).where(eq(emailCodes.id, id));
    return CANT_SEND;
  }
  return { ok: true };
}

/**
 * Someone tried to sign up with an address that already has an account: it gets a note saying so
 * instead of a code, so the sign-up form never tells anyone which addresses have accounts.
 */
export async function sendAccountExists(env: Env, teamId: string, email: string, ownTeam: boolean) {
  const db = createDb(env.DB);
  const now = Math.floor(Date.now() / 1000);
  if (await tooMany(db, teamId, email, now)) return;
  // Counted with the address's codes, so it can't be used to flood an inbox either.
  await db.insert(emailCodes).values({
    id: newId(),
    teamId,
    purpose: "signup",
    email,
    codeHash: "",
    usedAt: now,
    expiresAt: now,
    createdAt: now,
  });
  const team = await teamName(env, teamId);
  const line = ownTeam
    ? `Someone tried to sign up for ${team} on Gearbox with this email, but it already has an account. Sign in, or reset your password, at ${teamFrontend(env, teamId)}/login.`
    : `Someone tried to sign up for ${team} on Gearbox with this email, but it already has an account on another team. Each email can be on one team: sign up with a different one, or sign in on your own team's page.`;
  const after = "If it wasn't you, you can ignore this email.";
  await sendEmail(env, {
    teamId,
    kind: "account-exists" satisfies EmailKind,
    to: email,
    subject: "You already have an account",
    text: `${line}\n\n${after}\n`,
    html: `<p>${escapeHtml(line)}</p><p>${escapeHtml(after)}</p>`,
  });
}

export type CodeCheck =
  | { ok: true; userId: string | null; passwordHash: string | null }
  | { ok: false; error: string };

/** Checks the latest code for `purpose` sent to `email`; a right one is used up. */
export async function useCode(
  env: Env,
  input: { teamId: string; purpose: CodePurpose; email: string; code: unknown },
): Promise<CodeCheck> {
  const wrong = { ok: false as const, error: "That code isn't right. Check it and try again." };
  const code = typeof input.code === "string" ? input.code.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(code)) return wrong;
  const db = createDb(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .select()
    .from(emailCodes)
    .where(
      and(
        eq(emailCodes.teamId, input.teamId),
        eq(emailCodes.email, input.email),
        eq(emailCodes.purpose, input.purpose),
        isNull(emailCodes.usedAt),
      ),
    )
    .orderBy(desc(emailCodes.createdAt))
    .get();
  if (!row || row.expiresAt <= now) {
    return { ok: false, error: "That code has expired. Ask for a new one." };
  }
  if (row.attempts >= CODE_TRIES) {
    return { ok: false, error: "Too many wrong codes. Ask for a new one." };
  }
  if ((await hashCode(row.id, code)) !== row.codeHash) {
    await db
      .update(emailCodes)
      .set({ attempts: sql`${emailCodes.attempts} + 1` })
      .where(eq(emailCodes.id, row.id));
    return wrong;
  }
  // Used once: two tabs entering it at the same time can't both use it.
  const used = await db
    .update(emailCodes)
    .set({ usedAt: now })
    .where(and(eq(emailCodes.id, row.id), isNull(emailCodes.usedAt), gt(emailCodes.expiresAt, now)))
    .returning({ id: emailCodes.id });
  if (used.length === 0) return { ok: false, error: "That code has expired. Ask for a new one." };
  return { ok: true, userId: row.userId, passwordHash: row.passwordHash };
}

/** Whether people can use email sign-in on this team now. */
export async function emailSignInOn(env: Env, teamId: string): Promise<boolean> {
  if (isDemoTeam(teamId) || !emailSignInReady(env)) return false;
  return emailSignInChosen(createDb(env.DB), teamId);
}
