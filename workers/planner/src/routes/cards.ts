// SPDX-License-Identifier: AGPL-3.0-only
import {
  activeMembers,
  inTeam,
  requireAdmin,
  requireAuth,
  requireOAuthSession,
  withTeam,
} from "@g3/auth";
import { asc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type Db, createDb } from "../db";
import { cardMembers, cards } from "../db/schema";
import { CARD_COLUMNS, addCard, afterChange, toCard } from "../lib/cards";
import { type Column, inColumn, isTeamColumn, parseColumn, placeOf } from "../lib/columns";
import { nowSeconds, parseDueDate, parseId, parseTitle } from "../lib/input";
import { requireAssigner } from "../lib/trusted";
import type { AppEnv } from "../types";

// The team's board. Everyone signed in reads it; everyone but a kiosk adds, renames and moves
// cards, sets their due dates, and puts themselves on a card or takes themselves off. Mentors, admins and trusted
// students (src/lib/trusted.ts) put anyone on a card or take them off. Only admins delete cards. Pages
// poll GET /board (src/index.ts), so everyone's board follows the others'.

const TITLE_ERROR = "Give the card a title (up to 200 characters).";

/** A body's fields, whatever was sent. */
const fieldsOf = (value: unknown) =>
  (value && typeof value === "object" ? value : {}) as Record<string, unknown>;

const DATE_ERROR = "Give dates as a day, like 2026-11-21.";

/** A new card: its title, and a due date and a day to put it on the board, if it has them. */
const newCard = validator(
  "json",
  (value, c): { title: string; dueDate: string | null; startsOn: string | null } => {
    const v = fieldsOf(value);
    const title = parseTitle(v.title);
    if (!title) return c.json({ error: TITLE_ERROR }, 400) as never;
    const dueDate = parseDueDate(v.dueDate);
    const startsOn = parseDueDate(v.startsOn);
    if (dueDate === false || startsOn === false) {
      return c.json({ error: DATE_ERROR }, 400) as never;
    }
    return { title, dueDate: dueDate ?? null, startsOn: startsOn ?? null };
  },
);

type Changes = { title?: string; dueDate?: string | null; startsOn?: string | null };

/** A card's changes: a new title, its due date or its scheduled day (null clears either). */
const edit = validator("json", (value, c): Changes => {
  const v = fieldsOf(value);
  const changes: Changes = {};
  if (v.title !== undefined) {
    const title = parseTitle(v.title);
    if (!title) return c.json({ error: TITLE_ERROR }, 400) as never;
    changes.title = title;
  }
  const dueDate = parseDueDate(v.dueDate);
  const startsOn = parseDueDate(v.startsOn);
  if (dueDate === false || startsOn === false) return c.json({ error: DATE_ERROR }, 400) as never;
  if (dueDate !== undefined) changes.dueDate = dueDate;
  if (startsOn !== undefined) changes.startsOn = startsOn;
  if (!Object.keys(changes).length) {
    return c.json({ error: "Say what to change: the title or a date." }, 400) as never;
  }
  return changes;
});

const place = validator("json", (value, c): { column: Column; index: number } => {
  const v = fieldsOf(value);
  const column = parseColumn(v.column);
  const index = v.index;
  if (column === null || typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return c.json({ error: "Say which column and where in it." }, 400) as never;
  }
  return { column, index };
});

/** Every card with who's on it, in board order, as a page gets them. */
export async function boardCards(db: Db, teamId: string) {
  const [rows, members] = await Promise.all([
    db
      .select(CARD_COLUMNS)
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
  ]);
  const on = new Map<number, string[]>();
  for (const m of members) on.set(m.cardId, [...(on.get(m.cardId) ?? []), m.userId]);
  return rows.map((row) => ({ ...toCard(row), memberIds: on.get(row.id) ?? [] }));
}

export const cardsRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) =>
    c.json(await boardCards(createDb(c.env.PLANNER_DB), c.get("teamId"))),
  )
  // The team's names, for who's on each card.
  .get("/people", requireAuth, async (c) => {
    const members = await activeMembers(c.env, c.get("teamId"));
    if (!members) return c.json({ error: "Can't reach the team's member list. Try again." }, 503);
    return c.json(members.map(({ id, displayName }) => ({ id, displayName })));
  })
  // A new card, at the bottom of Not Started: every card starts there, at once or on its
  // `startsOn` day (it's off the board until then).
  .post("/", requireAuth, requireOAuthSession, newCard, async (c) => {
    const { title, ...dates } = c.req.valid("json");
    const teamId = c.get("teamId");
    const db = createDb(c.env.PLANNER_DB);
    const card = await addCard(db, teamId, title, c.get("userId"), dates);
    afterChange(c);
    return c.json(card, 201);
  })
  // Renames a card, or sets or clears its due date.
  .patch("/:id", requireAuth, requireOAuthSession, edit, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Card not found." }, 404);
    const changes = c.req.valid("json");
    const db = createDb(c.env.PLANNER_DB);
    const [card] = await db
      .update(cards)
      .set({ ...changes, updatedAt: nowSeconds() })
      .where(inTeam(cards, c.get("teamId"), eq(cards.id, id)))
      .returning(CARD_COLUMNS);
    if (!card) return c.json({ error: "Card not found." }, 404);
    afterChange(c);
    return c.json(toCard(card));
  })
  // Puts a card in a column ("not_started", "done" or a middle column's id) at `index` (0 is the
  // top), renumbering that column.
  .put("/:id/move", requireAuth, requireOAuthSession, place, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Card not found." }, 404);
    const { column, index } = c.req.valid("json");
    const db = createDb(c.env.PLANNER_DB);
    const teamId = c.get("teamId");
    const card = await db
      .select({ id: cards.id })
      .from(cards)
      .where(inTeam(cards, teamId, eq(cards.id, id)))
      .get();
    if (!card) return c.json({ error: "Card not found." }, 404);
    if (typeof column === "number" && !(await isTeamColumn(db, teamId, column))) {
      return c.json({ error: "That column is gone. Reload the board." }, 404);
    }

    const others = await db
      .select({ id: cards.id })
      .from(cards)
      .where(inTeam(cards, teamId, inColumn(column), ne(cards.id, id)))
      .orderBy(asc(cards.sortOrder), asc(cards.id))
      .all();
    const order = others.map((r) => r.id);
    order.splice(Math.min(index, order.length), 0, id);

    const now = nowSeconds();
    const place = placeOf(column);
    const [first, ...rest] = order.map((cardId, sortOrder) =>
      db
        .update(cards)
        // A scheduled card moved by hand is on the board from now on.
        .set(
          cardId === id ? { ...place, sortOrder, startsOn: null, updatedAt: now } : { sortOrder },
        )
        .where(inTeam(cards, teamId, eq(cards.id, cardId))),
    );
    await db.batch([first, ...rest]);
    afterChange(c);
    return c.json({ ok: true });
  })
  // Puts yourself on a card, or takes yourself off: only ever yourself.
  .put("/:id/members/me", requireAuth, requireOAuthSession, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Card not found." }, 404);
    const db = createDb(c.env.PLANNER_DB);
    const teamId = c.get("teamId");
    const card = await db
      .select({ id: cards.id })
      .from(cards)
      .where(inTeam(cards, teamId, eq(cards.id, id)))
      .get();
    if (!card) return c.json({ error: "Card not found." }, 404);
    await db
      .insert(cardMembers)
      .values(withTeam(teamId, { cardId: id, userId: c.get("userId"), addedAt: nowSeconds() }))
      .onConflictDoNothing();
    afterChange(c);
    return c.json({ ok: true });
  })
  .delete("/:id/members/me", requireAuth, requireOAuthSession, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Card not found." }, 404);
    await createDb(c.env.PLANNER_DB)
      .delete(cardMembers)
      .where(
        inTeam(
          cardMembers,
          c.get("teamId"),
          eq(cardMembers.cardId, id),
          eq(cardMembers.userId, c.get("userId")),
        ),
      );
    afterChange(c);
    return c.json({ ok: true });
  })
  // Puts someone else on a card, or takes them off: mentors, admins and trusted students.
  .put("/:id/members/:userId", requireAuth, requireOAuthSession, requireAssigner, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Card not found." }, 404);
    const userId = c.req.param("userId");
    const db = createDb(c.env.PLANNER_DB);
    const teamId = c.get("teamId");
    const [card, members] = await Promise.all([
      db
        .select({ id: cards.id })
        .from(cards)
        .where(inTeam(cards, teamId, eq(cards.id, id)))
        .get(),
      activeMembers(c.env, teamId),
    ]);
    if (!card) return c.json({ error: "Card not found." }, 404);
    if (!members) return c.json({ error: "Can't reach the team's member list. Try again." }, 503);
    if (!members.some((m) => m.id === userId)) {
      return c.json({ error: "Only the team's active members can go on a card." }, 400);
    }
    await db
      .insert(cardMembers)
      .values(withTeam(teamId, { cardId: id, userId, addedAt: nowSeconds() }))
      .onConflictDoNothing();
    afterChange(c);
    return c.json({ ok: true });
  })
  .delete("/:id/members/:userId", requireAuth, requireOAuthSession, requireAssigner, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Card not found." }, 404);
    await createDb(c.env.PLANNER_DB)
      .delete(cardMembers)
      .where(
        inTeam(
          cardMembers,
          c.get("teamId"),
          eq(cardMembers.cardId, id),
          eq(cardMembers.userId, c.req.param("userId")),
        ),
      );
    afterChange(c);
    return c.json({ ok: true });
  })
  // Only the team's admins delete cards.
  .delete("/:id", requireAdmin, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Card not found." }, 404);
    const db = createDb(c.env.PLANNER_DB);
    const [gone] = await db
      .delete(cards)
      .where(inTeam(cards, c.get("teamId"), eq(cards.id, id)))
      .returning({ id: cards.id });
    if (!gone) return c.json({ error: "Card not found." }, 404);
    afterChange(c);
    return c.json({ ok: true });
  });
