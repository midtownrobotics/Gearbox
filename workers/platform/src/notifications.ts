import { teamMembers } from "@g3/auth";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import {
  NOTIFICATION_SOURCES,
  NOTIFICATION_TYPES,
  type NotificationSource,
  type NotificationType,
  PORTAL_AUDIENCES,
  type PortalAudience,
  notifications,
  teamNotificationSettings,
  teams,
} from "./db/schema";
import { accounts, db, g3id, now } from "./lib";
import type { AppEnv } from "./types";

// Delivering notifications: Gearbox's, which operators write in the console (console.ts) for every
// team, and the team's own, which its admins write (team.ts). Each team's admins choose, for each
// source and type, who sees them on the team's home page (everyone, admins or nobody) and a
// channel on the team's chat (Slack or Discord); Gearbox's Critical ones can also be DMed to
// members. Chat messages are sent once, when the notification is written; the home page shows
// them until they expire.

type Bindings = AppEnv["Bindings"];

export type TypeSettings = {
  portal: PortalAudience;
  /** A Slack or Discord channel's id (whichever the team uses), or null. */
  channel: string | null;
  /** G3ID user ids, DMed on the team's chat: only for Gearbox's Critical ones, else empty. */
  users: string[];
};

export type NotificationSettings = Record<
  NotificationSource,
  Record<NotificationType, TypeSettings>
>;

/**
 * What a team hasn't set: Gearbox's show to admins on the home page, the team's own to everyone,
 * and nothing goes to its chat.
 */
const DEFAULTS: Record<NotificationSource, TypeSettings> = {
  gearbox: { portal: "admins", channel: null, users: [] },
  team: { portal: "everyone", channel: null, users: [] },
};

/** Only Gearbox's Critical notifications are DMed. */
export const takesDms = (source: NotificationSource, type: NotificationType) =>
  source === "gearbox" && type === "critical";

/** Every source and type, in the order the settings are listed. */
const SLOTS = NOTIFICATION_SOURCES.flatMap((source) =>
  NOTIFICATION_TYPES.map((type) => ({ source, type })),
);

const SOURCE_LABELS: Record<NotificationSource, string> = { gearbox: "Gearbox", team: "Team" };

export const MAX_USERS = 50;

const LABELS: Record<NotificationType, string> = {
  info: "Informational",
  critical: "Critical",
};

/** How long a notification's short description and full text may be. */
const SUMMARY_MAX = 140;
const BODY_MAX = 10_000;
/** How far ahead a notification's expiry may be. */
const EXPIRY_MAX_S = 365 * 24 * 60 * 60;

export type NewNotification = {
  type: NotificationType;
  summary: string;
  body: string;
  expiresAt: number;
};

/** Checks a notification being written (console or team), or says what's wrong in words. */
export function parseNotification(input: unknown): NewNotification | string {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const type = value.type as NotificationType;
  if (!NOTIFICATION_TYPES.includes(type)) return "Choose Informational or Critical.";
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  if (!summary || summary.length > SUMMARY_MAX) {
    return `Write a short description (up to ${SUMMARY_MAX} characters).`;
  }
  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (!body || body.length > BODY_MAX) {
    return `Write the full text (up to ${BODY_MAX} characters).`;
  }
  const expiresAt = value.expiresAt;
  if (
    typeof expiresAt !== "number" ||
    !Number.isInteger(expiresAt) ||
    expiresAt <= now() ||
    expiresAt > now() + EXPIRY_MAX_S
  ) {
    return "Choose when it expires: after now, within a year.";
  }
  return { type, summary, body, expiresAt };
}

const parseList = (json: string): string[] => {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

/** The team's settings for every source and type, defaults filled in. */
export async function notificationSettings(
  env: Bindings,
  teamId: string,
): Promise<NotificationSettings> {
  const rows = await db(env)
    .select()
    .from(teamNotificationSettings)
    .where(eq(teamNotificationSettings.teamId, teamId))
    .all();
  const out = { gearbox: {}, team: {} } as NotificationSettings;
  for (const { source, type } of SLOTS) {
    const row = rows.find((r) => r.source === source && r.type === type);
    out[source][type] = row
      ? {
          portal: row.portal,
          channel: row.channel,
          users: takesDms(source, type) ? parseList(row.dmUsers) : [],
        }
      : DEFAULTS[source];
  }
  return out;
}

/**
 * Checks settings sent by the team's page. `memberIds` are the team's members: anyone else can't
 * be sent a DM. People given for anything but Gearbox's Critical are left out. Gives back the
 * settings, or what's wrong in words.
 */
export function parseSettings(
  input: unknown,
  memberIds: Set<string>,
): NotificationSettings | string {
  const all = "Send the settings for every kind.";
  if (!input || typeof input !== "object") return all;
  const out = { gearbox: {}, team: {} } as NotificationSettings;
  for (const { source, type } of SLOTS) {
    const group = (input as Record<string, unknown>)[source] as
      | Record<string, Record<string, unknown> | undefined>
      | undefined;
    const value = group && typeof group === "object" ? group[type] : undefined;
    if (!value || typeof value !== "object") return all;
    const portal = value.portal as PortalAudience;
    if (!PORTAL_AUDIENCES.includes(portal)) {
      return "Choose who sees each kind on the home page.";
    }
    const given = value.channel ?? null;
    if (given !== null && typeof given !== "string") return all;
    // A channel ID as Slack gives it (C or G, then 8 or more capitals and digits) or as Discord
    // does (17 to 20 digits).
    const channel = given?.trim() || null;
    if (channel && !/^[CG][A-Z0-9]{8,}$/.test(channel) && !/^\d{17,20}$/.test(channel)) {
      return "That isn't a channel ID. Choose the channel by name.";
    }
    let users: string[] = [];
    if (takesDms(source, type)) {
      const list = Array.isArray(value.users) ? value.users : [];
      users = [...new Set(list.filter((u): u is string => typeof u === "string"))];
      if (users.some((u) => !memberIds.has(u))) return "Only your team's members can be sent DMs.";
      if (users.length > MAX_USERS) return `Up to ${MAX_USERS} people.`;
    }
    out[source][type] = { portal, channel, users };
  }
  return out;
}

/** Saves the team's settings for every source and type, in one batch. */
export async function saveSettings(
  env: Bindings,
  teamId: string,
  userId: string,
  settings: NotificationSettings,
) {
  const database = db(env);
  const [first, ...rest] = SLOTS.map(({ source, type }) => {
    const values = {
      portal: settings[source][type].portal,
      channel: settings[source][type].channel,
      dmUsers: JSON.stringify(settings[source][type].users),
      updatedAt: now(),
      updatedBy: userId,
    };
    return database
      .insert(teamNotificationSettings)
      .values({ teamId, source, type, ...values })
      .onConflictDoUpdate({
        target: [
          teamNotificationSettings.teamId,
          teamNotificationSettings.source,
          teamNotificationSettings.type,
        ],
        set: values,
      });
  });
  await database.batch([first, ...rest]);
}

/** Which parts changed, for the team's log ("Gearbox Critical: home page, DMs"). */
export function changedParts(before: NotificationSettings, after: NotificationSettings) {
  return SLOTS.flatMap(({ source, type }) => {
    const [b, a] = [before[source][type], after[source][type]];
    const parts = [
      b.portal !== a.portal && "home page",
      b.channel !== a.channel && "channel",
      JSON.stringify(b.users) !== JSON.stringify(a.users) && "DMs",
    ].filter(Boolean);
    return parts.length ? [`${SOURCE_LABELS[source]} ${LABELS[type]}: ${parts.join(", ")}`] : [];
  });
}

/** Names of the members who wrote these, by id; empty when G3ID can't say. */
async function writers(env: Bindings, ids: string[]) {
  try {
    return await accounts(env, ids);
  } catch (err) {
    console.error("[notifications] writers' names", err);
    return new Map<string, { displayName: string }>();
  }
}

/**
 * The notifications a member sees on the team's home page now, newest first: Gearbox's and the
 * team's own, with the name of the member who wrote a team one.
 */
export async function visibleNotifications(env: Bindings, teamId: string, isAdmin: boolean) {
  const settings = await notificationSettings(env, teamId);
  const shown = (source: NotificationSource, type: NotificationType) =>
    settings[source][type].portal === "everyone" ||
    (isAdmin && settings[source][type].portal === "admins");
  const active = await db(env)
    .select({
      id: notifications.id,
      type: notifications.type,
      teamId: notifications.teamId,
      summary: notifications.summary,
      body: notifications.body,
      createdBy: notifications.createdBy,
      createdAt: notifications.createdAt,
      expiresAt: notifications.expiresAt,
    })
    .from(notifications)
    .where(
      and(
        gt(notifications.expiresAt, now()),
        or(isNull(notifications.teamId), eq(notifications.teamId, teamId)),
      ),
    )
    .all();
  const list = active
    .filter((n) => shown(n.teamId ? "team" : "gearbox", n.type))
    .sort((a, b) => b.createdAt - a.createdAt);
  const names = await writers(
    env,
    list.filter((n) => n.teamId).map((n) => n.createdBy),
  );
  return list.map(({ teamId: team, createdBy, ...n }) => ({
    ...n,
    fromTeam: team !== null,
    // Only a team member's name: operators stay unnamed.
    createdByName: team ? (names.get(createdBy)?.displayName ?? null) : null,
  }));
}

/** The notifications the team's admins wrote, newest first, expired ones too. */
export async function teamWritten(env: Bindings, teamId: string) {
  const list = await db(env)
    .select()
    .from(notifications)
    .where(eq(notifications.teamId, teamId))
    .orderBy(desc(notifications.createdAt))
    .limit(200)
    .all();
  const names = await writers(
    env,
    list.map((n) => n.createdBy),
  );
  return list.map(({ teamId: _, ...n }) => ({
    ...n,
    createdByName: names.get(n.createdBy)?.displayName ?? null,
  }));
}

/**
 * The team's members, for choosing who gets DMs: active ones, with whether they've linked the
 * team's chat.
 */
export async function dmCandidates(env: Bindings, teamId: string) {
  const members = await teamMembers(env, teamId);
  if (!members) return null;
  return members
    .filter((m) => m.status === "active")
    .map((m) => ({
      id: m.id,
      displayName: m.displayName,
      isAdmin: m.isAdmin,
      hasChat: m.hasChat === true,
    }));
}

/**
 * The chat text (Gearbox's chat format), sent by the team's own bot, so it says plainly whose it
 * is: "Gearbox Critical Notification", or "Critical Notification from <name>" for one the team's
 * admin wrote, with the type's mark, then the short description and the full text as a quote.
 * Kept under 4,000 characters (the text is cut); Discord gets it in pieces.
 */
export function chatText(
  n: { type: NotificationType; summary: string; body: string },
  from?: string,
) {
  const mark = { info: "ℹ️", critical: "🚨" };
  const title = from
    ? `${LABELS[n.type]} Notification from ${from}`
    : `Gearbox ${LABELS[n.type]} Notification`;
  const head = `${mark[n.type]}  **${title}**\n`;
  // A quote bar down the side of every line of the notification itself, then cut to fit.
  let quoted = `**${n.summary.trim()}**\n${n.body.trim()}`
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const room = 3900 - head.length;
  if (quoted.length > room) quoted = `${quoted.slice(0, room - 1)}…`;
  return `${head}${quoted}`;
}

/**
 * Sends a new Gearbox notification to every active team's chosen channel (and, for a Critical
 * one, members) on its chat (Slack or Discord), from each team's own bot (through G3ID); or, with
 * `team`, the team's own to its chosen channel, under the name of the admin who wrote it. Never throws: a team without a chat, or a channel the bot
 * can't post in, is logged and skipped. Gives back how many teams it was sent to.
 */
export async function deliverToChat(
  env: Bindings,
  n: { type: NotificationType; summary: string; body: string },
  team?: { id: string; from: string },
): Promise<number> {
  const rows = await db(env)
    .select({
      teamId: teamNotificationSettings.teamId,
      channel: teamNotificationSettings.channel,
      dmUsers: teamNotificationSettings.dmUsers,
    })
    .from(teamNotificationSettings)
    .innerJoin(teams, eq(teams.id, teamNotificationSettings.teamId))
    .where(
      and(
        eq(teamNotificationSettings.source, team ? "team" : "gearbox"),
        eq(teamNotificationSettings.type, n.type),
        eq(teams.status, "active"),
        team ? eq(teamNotificationSettings.teamId, team.id) : undefined,
      ),
    )
    .all();
  const text = chatText(n, team?.from);
  let sentTo = 0;
  // A few teams at a time, so one slow team doesn't hold up the rest.
  for (let i = 0; i < rows.length; i += 10) {
    const results = await Promise.all(
      rows.slice(i, i + 10).map(async (row) => {
        const teamId = encodeURIComponent(row.teamId);
        const channel = row.channel;
        const users = takesDms(team ? "team" : "gearbox", n.type) ? parseList(row.dmUsers) : [];
        if (!channel && users.length === 0) return false;
        const sends = [
          ...(channel
            ? [
                g3id(env, `/teams/${teamId}/chat/message`, {
                  method: "POST",
                  body: { channel, text },
                }),
              ]
            : []),
          ...(users.length
            ? [
                g3id(env, `/teams/${teamId}/chat/dm-members`, {
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
            console.error("[notifications] chat delivery failed", row.teamId, why);
          }
        }
        return answers.some((a) => a.status === "fulfilled" && a.value.ok);
      }),
    );
    sentTo += results.filter(Boolean).length;
  }
  return sentTo;
}
