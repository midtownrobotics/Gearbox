// SPDX-License-Identifier: AGPL-3.0-only
import {
  type TeamMessageRef,
  activeMembers,
  editTeamMessage,
  inTeam,
  postTeamMessage,
  withTeam,
} from "@g3/auth";
import { teamAppUrl } from "@g3/site-config";
import { plainChatText } from "@g3/slack";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import {
  type Status,
  cardMembers,
  cards,
  overviewCards,
  overviews,
  plannerSettings,
} from "../db/schema";
import { listColumns } from "./columns";
import { dayIn, nowSeconds } from "./input";

// Meeting overviews: a message on the team's chat (Slack or Discord, through G3ID) listing what's
// Not Started and Started (the cards in the board's middle columns). Only the team's latest overview is kept up to
// date: after any change to the board, `updateOverview` rewrites it. Every card that has been on it
// stays: one moved to Done shows crossed off in the list it was last in, one deleted goes. The text is Gearbox's chat format (@g3/slack's toSlack
// turns it into Slack's), kept under one Discord message, since a message that's edited can't be
// split.

type Env = { G3ID: Fetcher };

/** Room for the text: one Discord message is 2,000 characters. */
const LIMIT = 1900;

export type OverviewCard = {
  id: number;
  title: string;
  status: Status;
  names: string[];
  /** "YYYY-MM-DD", or null. */
  dueDate?: string | null;
};

/** A due date as the overview says it: "Fri, Nov 21", with the year when it isn't this one. */
export function dueLabel(dueDate: string, now = new Date()): string {
  const [y, m, d] = dueDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(y === now.getUTCFullYear() ? {} : { year: "numeric" }),
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The overview's lists: a card in Done is shown in the one it was last in. */
export type Section = Exclude<Status, "done">;

const SECTIONS: { section: Section; title: string }[] = [
  { section: "not_started", title: "Not Started" },
  { section: "in_progress", title: "Started" },
];

/**
 * An overview's text: Not Started and Started (In Progress), each with its cards in board order,
 * then the cards of `onOverview` finished since it was posted, crossed off in the list they were
 * last in. A list too long for one message ends its longest sections with "…and N more".
 */
/** A time zone a browser sent, if it's one Gearbox knows; else null. */
export function parseTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/** The day an overview was sent, in its sender's time zone: "Tuesday, November 17, 2026". */
export function overviewDate(postedAt: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(postedAt * 1000));
}

export function overviewText(
  board: OverviewCard[],
  onOverview: ReadonlyMap<number, Section>,
  boardUrl: string,
  /** When it was sent, as `overviewDate` gives it. */
  date: string,
): string {
  const line = (card: OverviewCard) => {
    const title = plainChatText(card.title) || "Untitled";
    const who = card.names.length ? ` (${card.names.map(plainChatText).join(", ")})` : "";
    if (card.status === "done") return `• ~~${title}~~${who}`;
    const due = card.dueDate ? ` · due ${dueLabel(card.dueDate)}` : "";
    return `• ${title}${who}${due}`;
  };
  const lists = SECTIONS.map(({ section, title }) => ({
    title,
    lines: [
      ...board.filter((card) => card.status === section),
      ...board.filter((card) => card.status === "done" && onOverview.get(card.id) === section),
    ].map(line),
    hidden: 0,
  }));

  const render = () =>
    [
      `**📋 Meeting overview · ${date}**`,
      ...lists.flatMap((list) => [
        "",
        `**${list.title}**`,
        ...(list.lines.length || list.hidden ? list.lines : ["Nothing here."]),
        ...(list.hidden ? [`…and ${list.hidden} more`] : []),
      ]),
      "",
      `[Open the board](${boardUrl}) · Add a card with \`/gb-add\` in the channel`,
    ].join("\n");

  let text = render();
  while (text.length > LIMIT) {
    const longest = lists.reduce((a, b) => (b.lines.length > a.lines.length ? b : a));
    if (!longest.lines.length) break;
    longest.lines.pop();
    longest.hidden++;
    text = render();
  }
  return text;
}

/**
 * The board as the overview shows it: every card with the names of who's on it, in board order
 * (the middle columns left to right, each top to bottom).
 */
async function boardFor(
  db: Db,
  env: Env,
  teamId: string,
  /** The overview's day ("YYYY-MM-DD"): cards scheduled after it aren't on the board yet. */
  today: string,
): Promise<OverviewCard[]> {
  const [rows, members, people, columns] = await Promise.all([
    db
      .select({
        id: cards.id,
        title: cards.title,
        status: cards.status,
        columnId: cards.columnId,
        dueDate: cards.dueDate,
        startsOn: cards.startsOn,
      })
      .from(cards)
      .where(inTeam(cards, teamId))
      .orderBy(asc(cards.sortOrder), asc(cards.id))
      .all(),
    db
      .select({ cardId: cardMembers.cardId, userId: cardMembers.userId })
      .from(cardMembers)
      .where(inTeam(cardMembers, teamId))
      .orderBy(asc(cardMembers.addedAt))
      .all(),
    activeMembers(env, teamId).catch(() => null),
    listColumns(db, teamId),
  ]);
  const names = new Map((people ?? []).map((m) => [m.id, m.displayName]));
  const place = new Map(columns.map((col, i) => [col.id, i]));
  const ordered = rows
    .filter((card) => !card.startsOn || card.startsOn <= today)
    .map((card, i) => ({ card, i }))
    .sort(
      (a, b) =>
        (place.get(a.card.columnId ?? -1) ?? -1) - (place.get(b.card.columnId ?? -1) ?? -1) ||
        a.i - b.i,
    )
    .map(({ card }) => card);
  return ordered.map(({ columnId: _, startsOn: __, ...card }) => ({
    ...card,
    names: members
      .filter((m) => m.cardId === card.id && names.has(m.userId))
      .map((m) => names.get(m.userId) as string),
  }));
}

/** Records the cards now in Not Started or In Progress as on an overview, and in which list. */
async function remember(db: Db, teamId: string, overviewId: number, board: OverviewCard[]) {
  const open = board.filter((card) => card.status !== "done");
  if (!open.length) return;
  await db
    .insert(overviewCards)
    .values(
      withTeam(
        teamId,
        open.map((card) => ({ overviewId, cardId: card.id, section: card.status as Section })),
      ),
    )
    .onConflictDoUpdate({
      target: [overviewCards.overviewId, overviewCards.cardId],
      set: { section: sql`excluded.section` },
    });
}

/** The cards that have been on an overview, and the list each was last in. */
async function cardsOn(db: Db, teamId: string, overviewId: number) {
  const rows = await db
    .select({ cardId: overviewCards.cardId, section: overviewCards.section })
    .from(overviewCards)
    .where(inTeam(overviewCards, teamId, eq(overviewCards.overviewId, overviewId)))
    .all();
  return new Map(rows.map((r) => [r.cardId, r.section]));
}

/** The channel the team's overviews go to, or null until an admin picks one. */
export async function overviewChannel(db: Db, teamId: string): Promise<string | null> {
  const row = await db
    .select({ channel: plannerSettings.overviewChannel })
    .from(plannerSettings)
    .where(inTeam(plannerSettings, teamId))
    .get();
  return row?.channel ?? null;
}

/** Posts a new overview to the team's channel; from then on it's the one kept up to date. */
export async function sendOverview(
  db: Db,
  env: Env,
  teamId: string,
  userId: string,
  /** The sender's time zone, for the date (`parseTimeZone`). */
  timeZone: string,
): Promise<{ ok: true; postedAt: number } | { ok: false; error: string }> {
  const channel = await overviewChannel(db, teamId);
  if (!channel)
    return { ok: false, error: "Choose a channel for overviews on Planner's Admin page." };
  const postedAt = nowSeconds();
  const board = await boardFor(db, env, teamId, dayIn(timeZone, postedAt));
  const open = new Map(
    board.flatMap((c) => (c.status === "done" ? [] : [[c.id, c.status as Section] as const])),
  );
  const text = overviewText(
    board,
    open,
    teamAppUrl(teamId, "planner"),
    overviewDate(postedAt, timeZone),
  );
  const posted = await postTeamMessage(env, teamId, channel, text);
  if (!posted.ok) return { ok: false, error: chatError(posted.error) };

  const [overview] = await db
    .insert(overviews)
    .values(
      withTeam(teamId, {
        provider: posted.message.provider,
        channel: posted.message.channel,
        messageId: posted.message.id,
        lastText: text,
        postedBy: userId,
        postedAt,
        timeZone,
      }),
    )
    .returning({ id: overviews.id });
  await remember(db, teamId, overview.id, board);
  return { ok: true, postedAt };
}

/**
 * Rewrites the team's latest overview after a change to the board, if its text changed. Never
 * throws: a failed edit is logged, and the next change tries again.
 */
export async function updateOverview(db: Db, env: Env, teamId: string): Promise<void> {
  try {
    const latest = await db
      .select()
      .from(overviews)
      .where(inTeam(overviews, teamId))
      .orderBy(desc(overviews.id))
      .limit(1)
      .get();
    if (!latest) return;
    const timeZone = parseTimeZone(latest.timeZone) ?? "UTC";
    const board = await boardFor(db, env, teamId, dayIn(timeZone));
    await remember(db, teamId, latest.id, board);
    const text = overviewText(
      board,
      await cardsOn(db, teamId, latest.id),
      teamAppUrl(teamId, "planner"),
      // Always the day it was sent, however long it keeps updating.
      overviewDate(latest.postedAt, timeZone),
    );
    if (text === latest.lastText) return;
    const message: TeamMessageRef = {
      provider: latest.provider,
      channel: latest.channel,
      id: latest.messageId,
    };
    const edited = await editTeamMessage(env, teamId, message, text);
    if (!edited.ok) {
      console.error("[overview] edit failed", teamId, edited.error);
      return;
    }
    await db
      .update(overviews)
      .set({ lastText: text })
      .where(inTeam(overviews, teamId, eq(overviews.id, latest.id)));
  } catch (err) {
    console.error("[overview] update failed", teamId, err);
  }
}

/** What to tell someone whose overview wasn't posted, from the chat service's reason. */
function chatError(error: string): string {
  if (/hasn't connected/.test(error)) {
    return "Your team hasn't connected Slack or Discord. An admin connects it on Integrations, in Portal.";
  }
  if (error === "not_in_channel" || error === "missing_permissions") {
    return "The bot can't post in that channel. Add it to the channel, or choose another on Planner's Admin page.";
  }
  if (error === "channel_not_found") {
    return "That channel is gone. Choose another on Planner's Admin page.";
  }
  return `The overview wasn't posted (${error}).`;
}
