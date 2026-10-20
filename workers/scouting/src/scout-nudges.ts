import { TEAM_HEADER, activeMembers, inTeam, sendMemberDM, teamHasApp, withTeam } from "@g3/auth";
import { teamAppUrlVia } from "@g3/site-config";
import { desc, inArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { dbOf } from "./db";
import { scoutNudges, strategyPresence } from "./db/schema";
import { requireAuth } from "./middleware/auth";
import { isStrategyAdmin } from "./roles";
import type { AppEnv } from "./types";
import { id } from "./utils";

// Inactive scouts, on the Competition overview: the people the team's Schedule has on scouting
// duty right now who aren't scouting in the app, and a nudge that asks one to come scout with a
// message from the team's bot (Slack or Discord, through G3ID). Only for a team with Schedule on
// and a chat connected.

type Ctx = Context<AppEnv>;
type Chat = "slack" | "discord";

/** Pages where someone is scouting: match and pit forms, and playoff scouting. */
const SCOUTING_PAGES = new Set(["forms", "playoffs"]);
/** Seen this recently counts as in the app: two missed heartbeats, like the Live users list. */
const ONLINE_MS = 75_000;
/** How long before the same person can be nudged again. */
export const NUDGE_GAP_MS = 5 * 60_000;

/** Someone on a scouting role now, as Schedule's `peopleNow` gives them. */
type OnDuty = {
  userId: string;
  displayName: string | null;
  roleName: string;
  startsAt: number;
  endsAt: number;
};

export type InactiveScout = {
  userId: string;
  name: string;
  roleName: string;
  /** When their scouting shift ends (ms). */
  until: number;
  /** When they were last in Scouting, if ever. */
  lastSeenAt: number | null;
  /** The page they're on instead of scouting, when they're in the app; null when they aren't. */
  elsewhere: string | null;
  /** Since when they haven't been in the app during their shift (null while they're elsewhere in it). */
  inactiveSince: number | null;
  /** Their chat is linked, so the team's bot can reach them. */
  canNudge: boolean;
  nudgedAt: number | null;
};

type Overview =
  | { available: false }
  | { available: true; chat: Chat; scouts: InactiveScout[]; onDuty: number; error?: string };

/** The team's chat, from G3ID (its public answer for the team in the header). */
async function teamChat(c: Ctx): Promise<Chat | null> {
  try {
    const res = await c.env.G3ID.fetch(
      new Request("http://g3id/api/team/chat", { headers: { [TEAM_HEADER]: c.get("teamId") } }),
    );
    if (!res.ok) return null;
    const { provider } = (await res.json()) as { provider?: string | null };
    return provider === "slack" || provider === "discord" ? provider : null;
  } catch {
    return null;
  }
}

/** Who's on a scouting role now, from the team's Schedule; null when it can't be reached. */
async function onDuty(c: Ctx): Promise<OnDuty[] | null> {
  const schedule = c.env.SCHEDULE;
  if (!schedule) return null;
  try {
    const res = await schedule.fetch(
      new Request(
        `http://schedule/api/internal/teams/${encodeURIComponent(c.get("teamId"))}/now?type=scouting`,
      ),
    );
    if (!res.ok) return null;
    return ((await res.json()) as { people: OnDuty[] }).people;
  } catch {
    return null;
  }
}

/** The inactive scouts as they stand, or why the section isn't shown. */
export async function inactiveScouts(c: Ctx): Promise<Overview> {
  const teamId = c.get("teamId");
  if (!c.env.SCHEDULE || (await teamHasApp(c.env, teamId, "schedule")) === false)
    return { available: false };
  const chat = await teamChat(c);
  if (!chat) return { available: false };
  const people = await onDuty(c);
  if (!people)
    return { available: true, chat, scouts: [], onDuty: 0, error: "Couldn't reach Schedule." };
  if (!people.length) return { available: true, chat, scouts: [], onDuty: 0 };
  const ids = people.map((person) => person.userId);
  const db = dbOf(c);
  const [presence, nudges, members] = await Promise.all([
    db
      .select()
      .from(strategyPresence)
      .where(inTeam(strategyPresence, teamId, inArray(strategyPresence.user_id, ids)))
      .all(),
    db
      .select()
      .from(scoutNudges)
      .where(inTeam(scoutNudges, teamId, inArray(scoutNudges.user_id, ids)))
      .orderBy(desc(scoutNudges.nudged_at))
      .all(),
    activeMembers(c.env, teamId),
  ]);
  const now = Date.now();
  const scouts: InactiveScout[] = [];
  for (const person of people) {
    const seen = presence.find((row) => row.user_id === person.userId);
    const online = seen && seen.last_seen_at >= now - ONLINE_MS;
    if (online && SCOUTING_PAGES.has(seen.current_page ?? "forms")) continue;
    const member = members?.find((m) => m.id === person.userId);
    scouts.push({
      userId: person.userId,
      name: person.displayName ?? member?.displayName ?? seen?.display_name ?? "Member",
      roleName: person.roleName,
      until: person.endsAt,
      lastSeenAt: seen?.last_seen_at ?? null,
      elsewhere: online ? (seen.current_page ?? null) : null,
      // Away since they left the app, but never counted from before their shift started.
      inactiveSince: online ? null : Math.max(seen?.last_seen_at ?? 0, person.startsAt),
      canNudge: Boolean(member?.hasChat),
      nudgedAt: nudges.find((row) => row.user_id === person.userId)?.nudged_at ?? null,
    });
  }
  // Away longest first, then those in the app on another page.
  scouts.sort((a, b) => (a.inactiveSince ?? now) - (b.inactiveSince ?? now));
  return { available: true, chat, scouts, onDuty: people.length };
}

const chatName = (chat: Chat) => (chat === "slack" ? "Slack" : "Discord");

export const scoutNudgeRoutes = new Hono<AppEnv>()
  .get("/inactive-scouts", requireAuth, async (c) => {
    if (!(await isStrategyAdmin(c)))
      return c.json({ error: "Strategy lead access required." }, 403);
    return c.json(await inactiveScouts(c));
  })
  .post("/inactive-scouts/:userId/nudge", requireAuth, async (c) => {
    if (!(await isStrategyAdmin(c)))
      return c.json({ error: "Strategy lead access required." }, 403);
    const overview = await inactiveScouts(c);
    if (!overview.available)
      return c.json({ error: "Nudges need Schedule and your team's chat connected." }, 409);
    if (overview.error) return c.json({ error: overview.error }, 503);
    const scout = overview.scouts.find((item) => item.userId === c.req.param("userId"));
    if (!scout) return c.json({ error: "They're scouting now, or not on scouting duty." }, 409);
    if (!scout.canNudge)
      return c.json({ error: `They haven't linked ${chatName(overview.chat)}.` }, 409);
    const now = Date.now();
    if (scout.nudgedAt && now - scout.nudgedAt < NUDGE_GAP_MS)
      return c.json({ error: "They were nudged a few minutes ago." }, 429);
    const url = teamAppUrlVia(c.env.LOCAL_GATEWAY_URL || undefined, c.get("teamId"), "scouting");
    const lead = c.get("userDisplayName") || "A strategy lead";
    const sent = await sendMemberDM(
      c.env,
      c.get("teamId"),
      [scout.userId],
      `👋 **${lead}** is asking you to come scout. You're on **${scout.roleName}** until <t:${Math.floor(scout.until / 1000)}:t>.\n[Open Scouting](${url})`,
    );
    if (!sent) return c.json({ error: "The message couldn't be sent. Try again." }, 502);
    await dbOf(c)
      .insert(scoutNudges)
      .values(
        withTeam(c.get("teamId"), {
          id: id("nudge"),
          user_id: scout.userId,
          nudged_by: c.get("userId"),
          nudged_at: now,
        }),
      )
      .run();
    return c.json({ ok: true, nudgedAt: now });
  });
