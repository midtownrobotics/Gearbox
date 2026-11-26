// SPDX-License-Identifier: AGPL-3.0-only
import { hostDomain } from "@g3/site-config";
import { and, desc, gte, sql } from "drizzle-orm";
import { createDb } from "../db";
import { emailSends } from "../db/schema";
import type { AppEnv } from "../types";

// Sending email with Cloudflare Email Service (the `EMAIL` send_email binding; docs/deploy.md,
// "Email"). G3ID is the only worker that sends, and only codes for email sign-in
// (lib/email-sign-in.ts).
//
// The cap: Workers Paid includes 3,000 emails a month for the whole account, counted over its
// billing period, which is never longer than 31 days. So G3ID counts every email it sends
// (`email_sends`, by day, team and kind, never the address) and sends nothing once the last 31
// days reach EMAIL_LIMIT: whenever a billing period started, everything in it is inside that
// window. Production and staging share the account, so their limits add up to 3,000.

type Env = AppEnv["Bindings"];

/** Days added up for the cap: the longest billing period. */
export const EMAIL_WINDOW_DAYS = 31;

/** Why G3ID sends an email. */
export type EmailKind = "add-password" | "signup" | "reset" | "account-exists";
export const EMAIL_KINDS: readonly EmailKind[] = [
  "add-password",
  "signup",
  "reset",
  "account-exists",
];

/** This deployment's cap over the last 31 days (EMAIL_LIMIT), 0 when it isn't set. */
export function emailLimit(env: Env): number {
  const limit = Number(env.EMAIL_LIMIT);
  return Number.isInteger(limit) && limit > 0 ? limit : 0;
}

/** This deployment can send email: the binding and a limit. */
export const emailReady = (env: Env) => !!env.EMAIL && emailLimit(env) > 0;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The first day in the cap's window, as YYYY-MM-DD. */
export const windowStart = (now = Date.now()) =>
  dayOf(now - (EMAIL_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);

type Db = ReturnType<typeof createDb>;

async function sentInWindow(db: Db, now: number): Promise<number> {
  // tenancy: all teams (the cap is the whole account's)
  const row = await db
    .select({ total: sql<number>`coalesce(sum(${emailSends.count}), 0)` })
    .from(emailSends)
    .where(gte(emailSends.day, windowStart(now)))
    .get();
  return Number(row?.total ?? 0);
}

async function addSend(db: Db, day: string, teamId: string, kind: EmailKind, by: number) {
  await db
    .insert(emailSends)
    .values({ day, teamId, kind, count: by })
    .onConflictDoUpdate({
      target: [emailSends.day, emailSends.teamId, emailSends.kind],
      set: { count: sql`${emailSends.count} + ${by}` },
    });
}

export type Email = {
  teamId: string;
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type SendResult = { ok: true } | { ok: false; reason: "limit" | "off" | "failed" };

/**
 * Sends one email, unless the cap is reached. It's counted before it goes, so two at once can't
 * both pass the last place; one that fails to send is taken off again.
 */
export async function sendEmail(env: Env, email: Email): Promise<SendResult> {
  if (!emailReady(env) || !env.EMAIL) return { ok: false, reason: "off" };
  const db = createDb(env.DB);
  const now = Date.now();
  const day = dayOf(now);
  await addSend(db, day, email.teamId, email.kind, 1);
  if ((await sentInWindow(db, now)) > emailLimit(env)) {
    await addSend(db, day, email.teamId, email.kind, -1);
    console.warn("[email] the sending limit is reached; nothing sent");
    return { ok: false, reason: "limit" };
  }
  try {
    await env.EMAIL.send({
      from: { email: `noreply@${hostDomain}`, name: "Gearbox" },
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    return { ok: true };
  } catch (err) {
    await addSend(db, day, email.teamId, email.kind, -1);
    console.error("[email] sending failed", (err as { code?: string }).code ?? err);
    return { ok: false, reason: "failed" };
  }
}

export type EmailUsage = {
  ready: boolean;
  limit: number;
  windowDays: number;
  /** Sent in the last 31 days, which the limit counts. */
  sent: number;
  /** Each day in the window with sends, oldest first. */
  days: { day: string; count: number }[];
  byKind: Record<EmailKind, number>;
  /** The teams that sent the most in the window, most first. */
  teams: { teamId: string; count: number }[];
};

/** What G3ID sent in the cap's window, for the operators' console. Counts only. */
export async function emailUsage(env: Env): Promise<EmailUsage> {
  const db = createDb(env.DB);
  const from = windowStart();
  // tenancy: all teams (the operators' console sees the whole account)
  const rows = await db
    .select({
      day: emailSends.day,
      teamId: emailSends.teamId,
      kind: emailSends.kind,
      count: emailSends.count,
    })
    .from(emailSends)
    .where(and(gte(emailSends.day, from), sql`${emailSends.count} > 0`))
    .orderBy(desc(emailSends.day))
    .all();
  const days = new Map<string, number>();
  const teams = new Map<string, number>();
  const byKind = Object.fromEntries(EMAIL_KINDS.map((k) => [k, 0])) as Record<EmailKind, number>;
  for (const r of rows) {
    days.set(r.day, (days.get(r.day) ?? 0) + r.count);
    teams.set(r.teamId, (teams.get(r.teamId) ?? 0) + r.count);
    if (r.kind in byKind) byKind[r.kind as EmailKind] += r.count;
  }
  return {
    ready: emailReady(env),
    limit: emailLimit(env),
    windowDays: EMAIL_WINDOW_DAYS,
    sent: [...days.values()].reduce((n, c) => n + c, 0),
    days: [...days]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
    byKind,
    teams: [...teams]
      .map(([teamId, count]) => ({ teamId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

/** Moves a team's counts to its new id (a team that changed program). */
export const MOVE_EMAIL_SENDS = [
  `INSERT INTO email_sends (day, team_id, kind, count)
   SELECT day, ?2, kind, count FROM email_sends WHERE team_id = ?1
   ON CONFLICT (day, team_id, kind) DO UPDATE SET count = email_sends.count + excluded.count`,
  "DELETE FROM email_sends WHERE team_id = ?1",
];
