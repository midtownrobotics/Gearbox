import { teamMembers } from "@g3/auth";
import { and, eq, gt } from "drizzle-orm";
import {
  NOTIFICATION_TYPES,
  type NotificationType,
  PORTAL_AUDIENCES,
  type PortalAudience,
  notifications,
  teamNotificationSettings,
  teams,
} from "./db/schema";
import { db, g3id, now } from "./lib";
import type { AppEnv } from "./types";

// Delivering the notifications operators write in the console (console.ts). Each team's admins
// choose, per type, who sees them on the team's home page (everyone, admins or nobody), a Slack
// channel and the members they're sent to. Slack is sent once, when the notification is
// written, to every active team; the home page shows them until they expire.

type Bindings = AppEnv["Bindings"];

export type TypeSettings = {
  portal: PortalAudience;
  /** A Slack channel's id, or null. */
  slackChannel: string | null;
  /** G3ID user ids. */
  slackUsers: string[];
};

export type NotificationSettings = Record<NotificationType, TypeSettings>;

/** A type the team hasn't set: admins see it on the home page, and nothing goes to Slack. */
const DEFAULT: TypeSettings = { portal: "admins", slackChannel: null, slackUsers: [] };

export const MAX_USERS = 50;

const LABELS: Record<NotificationType, string> = {
  info: "Informational",
  warning: "Warning",
  critical: "Critical",
};

const parseList = (json: string): string[] => {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

/** The team's settings for every type, defaults filled in. */
export async function notificationSettings(
  env: Bindings,
  teamId: string,
): Promise<NotificationSettings> {
  const rows = await db(env)
    .select()
    .from(teamNotificationSettings)
    .where(eq(teamNotificationSettings.teamId, teamId))
    .all();
  return Object.fromEntries(
    NOTIFICATION_TYPES.map((type) => {
      const row = rows.find((r) => r.type === type);
      return [
        type,
        row
          ? {
              portal: row.portal,
              slackChannel: row.slackChannel,
              slackUsers: parseList(row.slackUsers),
            }
          : DEFAULT,
      ];
    }),
  ) as NotificationSettings;
}

/**
 * Checks settings sent by the team's page. `memberIds` are the team's members: anyone else can't
 * be sent a DM. Gives back the settings, or what's wrong in words.
 */
export function parseSettings(
  input: unknown,
  memberIds: Set<string>,
): NotificationSettings | string {
  if (!input || typeof input !== "object") return "Send the settings for every type.";
  const out: Partial<NotificationSettings> = {};
  for (const type of NOTIFICATION_TYPES) {
    const value = (input as Record<string, unknown>)[type] as Record<string, unknown> | undefined;
    if (!value || typeof value !== "object") return "Send the settings for every type.";
    const portal = value.portal as PortalAudience;
    if (!PORTAL_AUDIENCES.includes(portal)) {
      return "Choose who sees each type on the home page.";
    }
    const channel = value.slackChannel;
    const users = Array.isArray(value.slackUsers) ? value.slackUsers : null;
    if ((channel !== null && typeof channel !== "string") || !users) {
      return "Send the Slack channel and people for every type.";
    }
    // A Slack channel ID as Slack gives it: C or G, then 8 or more capitals and digits.
    const slackChannel = channel?.trim() || null;
    if (slackChannel && !/^[CG][A-Z0-9]{8,}$/.test(slackChannel)) {
      return "That isn't a Slack channel ID. Choose the channel by name.";
    }
    const slackUsers = [...new Set(users.filter((u): u is string => typeof u === "string"))];
    if (slackUsers.some((u) => !memberIds.has(u)))
      return "Only your team's members can be sent DMs.";
    if (slackUsers.length > MAX_USERS) return `Up to ${MAX_USERS} people for each type.`;
    out[type] = { portal, slackChannel, slackUsers };
  }
  return out as NotificationSettings;
}

/** Saves the team's settings for every type, in one batch. */
export async function saveSettings(
  env: Bindings,
  teamId: string,
  userId: string,
  settings: NotificationSettings,
) {
  const database = db(env);
  const [first, ...rest] = NOTIFICATION_TYPES.map((type) => {
    const values = {
      portal: settings[type].portal,
      slackChannel: settings[type].slackChannel,
      slackUsers: JSON.stringify(settings[type].slackUsers),
      updatedAt: now(),
      updatedBy: userId,
    };
    return database
      .insert(teamNotificationSettings)
      .values({ teamId, type, ...values })
      .onConflictDoUpdate({
        target: [teamNotificationSettings.teamId, teamNotificationSettings.type],
        set: values,
      });
  });
  await database.batch([first, ...rest]);
}

/** Which parts changed, for the team's log ("Critical: home page, Slack channel"). */
export function changedParts(before: NotificationSettings, after: NotificationSettings) {
  return NOTIFICATION_TYPES.flatMap((type) => {
    const parts = [
      before[type].portal !== after[type].portal && "home page",
      before[type].slackChannel !== after[type].slackChannel && "Slack channel",
      JSON.stringify(before[type].slackUsers) !== JSON.stringify(after[type].slackUsers) &&
        "Slack DMs",
    ].filter(Boolean);
    return parts.length ? [`${LABELS[type]}: ${parts.join(", ")}`] : [];
  });
}

/** The notifications a member sees on the team's home page now, newest first. */
export async function visibleNotifications(env: Bindings, teamId: string, isAdmin: boolean) {
  const settings = await notificationSettings(env, teamId);
  const shown = (type: NotificationType) =>
    settings[type].portal === "everyone" || (isAdmin && settings[type].portal === "admins");
  const active = await db(env)
    .select({
      id: notifications.id,
      type: notifications.type,
      summary: notifications.summary,
      body: notifications.body,
      createdAt: notifications.createdAt,
      expiresAt: notifications.expiresAt,
    })
    .from(notifications)
    .where(gt(notifications.expiresAt, now()))
    .all();
  return active.filter((n) => shown(n.type)).sort((a, b) => b.createdAt - a.createdAt);
}

/** The team's members, for choosing who gets DMs: active ones, with whether they've linked Slack. */
export async function dmCandidates(env: Bindings, teamId: string) {
  const members = await teamMembers(env, teamId);
  if (!members) return null;
  return members
    .filter((m) => m.status === "active")
    .map((m) => ({
      id: m.id,
      displayName: m.displayName,
      isAdmin: m.isAdmin,
      hasSlack: m.hasSlack === true,
    }));
}

/**
 * The Slack text, sent by the team's own bot, so it says plainly that it's Gearbox's: "Gearbox
 * Critical Notification" with the type's mark, then the short description and the full text as a
 * quote. Kept under Slack's 4,000 characters (the text is cut).
 */
export function slackText(n: { type: NotificationType; summary: string; body: string }) {
  const mark = { info: ":information_source:", warning: ":warning:", critical: ":rotating_light:" };
  const head = `${mark[n.type]}  *Gearbox ${LABELS[n.type]} Notification*\n`;
  // A quote bar down the side of every line of the notification itself, then cut to fit.
  let quoted = `*${n.summary.trim()}*\n${n.body.trim()}`
    .split("\n")
    .map((line) => `>${line}`)
    .join("\n");
  const room = 3900 - head.length;
  if (quoted.length > room) quoted = `${quoted.slice(0, room - 1)}…`;
  return `${head}${quoted}`;
}

/**
 * Sends a new notification to every active team's chosen Slack channel and members, from each
 * team's own bot (through G3ID). Never throws: a team without Slack, or a channel the bot isn't
 * in, is logged and skipped. Gives back how many teams it was sent to.
 */
export async function deliverToSlack(
  env: Bindings,
  n: { type: NotificationType; summary: string; body: string },
): Promise<number> {
  const rows = await db(env)
    .select({
      teamId: teamNotificationSettings.teamId,
      slackChannel: teamNotificationSettings.slackChannel,
      slackUsers: teamNotificationSettings.slackUsers,
    })
    .from(teamNotificationSettings)
    .innerJoin(teams, eq(teams.id, teamNotificationSettings.teamId))
    .where(and(eq(teamNotificationSettings.type, n.type), eq(teams.status, "active")))
    .all();
  const text = slackText(n);
  let sentTo = 0;
  // A few teams at a time, so one slow Slack doesn't hold up the rest.
  for (let i = 0; i < rows.length; i += 10) {
    const results = await Promise.all(
      rows.slice(i, i + 10).map(async (row) => {
        const teamId = encodeURIComponent(row.teamId);
        const channel = row.slackChannel;
        const users = parseList(row.slackUsers);
        if (!channel && users.length === 0) return false;
        const sends = [
          ...(channel
            ? [
                g3id(env, `/teams/${teamId}/slack/message`, {
                  method: "POST",
                  body: { channel, text },
                }),
              ]
            : []),
          ...(users.length
            ? [
                g3id(env, `/teams/${teamId}/slack/dm-members`, {
                  method: "POST",
                  body: { userIds: users, text },
                }),
              ]
            : []),
        ];
        const answers = await Promise.allSettled(sends);
        for (const answer of answers) {
          if (answer.status === "rejected" || !answer.value.ok) {
            const why =
              answer.status === "rejected"
                ? String(answer.reason)
                : await answer.value.text().catch(() => String(answer.value.status));
            console.error("[notifications] slack delivery failed", row.teamId, why);
          }
        }
        return answers.some((a) => a.status === "fulfilled" && a.value.ok);
      }),
    );
    sentTo += results.filter(Boolean).length;
  }
  return sentTo;
}
