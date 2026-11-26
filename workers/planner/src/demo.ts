// SPDX-License-Identifier: AGPL-3.0-only
import { withTeam } from "@g3/auth";
import { DEMO_PEOPLE, type DemoPerson, vocabularyOf } from "@g3/demo";
import type { Db } from "./db";
import { type Status, cardMembers, cards } from "./db/schema";
import { addColumn } from "./lib/columns";

// The public demo's Planner (roadmap 5.3), loaded after its nightly reset: a board with two
// middle columns, a few cards in each column, people on the ones under way, and due dates on the
// first card of each open column (a few days from the reset, so they never go stale).

const NOT_STARTED = ["Order spare bearings", "Practice autos", "Write the build log"];
const MIDDLE: { name: string; cards: string[] }[] = [
  { name: "In Progress", cards: ["Wire the drivetrain", "Update the CAD"] },
  { name: "Testing", cards: ["Test the new intake"] },
];
const DONE = ["Pick up the field elements", "Inventory the pit cart"];

export async function loadDemo(db: Db, teamId: string) {
  const seconds = Math.floor(Date.now() / 1000);
  const mentor = DEMO_PEOPLE[1] as DemoPerson;
  const lanes: { status: Status; columnId: number | null; titles: string[] }[] = [
    { status: "not_started", columnId: null, titles: NOT_STARTED },
  ];
  for (const column of MIDDLE) {
    const made = await addColumn(db, teamId, column.name, null);
    lanes.push({ status: "in_progress", columnId: made.id, titles: column.cards });
  }
  lanes.push({ status: "done", columnId: null, titles: DONE });

  const daysFromNow = (days: number) =>
    new Date((seconds + days * 86_400) * 1000).toISOString().slice(0, 10);
  const rows = lanes.flatMap(({ status, columnId, titles }, lane) =>
    titles.map((title, sortOrder) => ({
      title,
      status,
      columnId,
      sortOrder,
      dueDate: status !== "done" && sortOrder === 0 ? daysFromNow(3 + lane * 4) : null,
      createdBy: mentor.id,
      createdAt: seconds,
      updatedAt: seconds,
    })),
  );
  const made = await db
    .insert(cards)
    .values(withTeam(teamId, rows))
    .returning({ id: cards.id, status: cards.status });
  // Two people on each card under way, one on each done.
  const people = made.flatMap((card, i) =>
    card.status === "not_started"
      ? []
      : DEMO_PEOPLE.slice(i % 3, (i % 3) + (card.status === "in_progress" ? 2 : 1)).map((p) => ({
          cardId: card.id,
          userId: p.id,
          addedAt: seconds,
        })),
  );
  if (people.length) await db.insert(cardMembers).values(withTeam(teamId, people));
  return { cards: rows.length };
}

/** The words in the sample data, which demo visitors may send back. */
export const demoWords = (): string[] => vocabularyOf(NOT_STARTED, MIDDLE, DONE);
