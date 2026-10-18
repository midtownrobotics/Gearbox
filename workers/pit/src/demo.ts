import { withTeam } from "@g3/auth";
import { DEMO_PEOPLE, type DemoPerson, SAFE_TEXT, vocabularyOf } from "@g3/demo";
import { buildSnapshot } from "./archives";
import type { createDb } from "./db";
import {
  batteries,
  checklistArchives,
  checklistIssues,
  checklistItems,
  checklistLists,
  settings,
} from "./db/schema";

// The public demo's Pit (roadmap 5.3), loaded after its nightly reset: two checklists partway
// done, a couple of open issues, batteries in each state, two archives, and a past public event.

type Db = ReturnType<typeof createDb>;
const HOUR = 60 * 60;

const LISTS = [
  {
    name: "Before each match",
    items: [
      { name: "Drive base", topic: true },
      { name: SAFE_TEXT.checklist[0], checked: true },
      { name: SAFE_TEXT.checklist[1], checked: true },
      { name: SAFE_TEXT.checklist[2], issue: SAFE_TEXT.issue[0] },
      { name: "Intake", topic: true },
      { name: SAFE_TEXT.checklist[3], checked: true },
      { name: SAFE_TEXT.checklist[6] },
      { name: SAFE_TEXT.checklist[5], issue: SAFE_TEXT.issue[4] },
    ],
  },
  {
    name: "End of day",
    items: [
      { name: SAFE_TEXT.checklist[4], checked: true },
      { name: SAFE_TEXT.checklist[0] },
      { name: SAFE_TEXT.checklist[1] },
    ],
  },
];

const BATTERIES = [
  { name: "A1", state: "In Robot", voltage: 12.9, uses: 14 },
  { name: "B2", state: "Next Up", voltage: 13.1, uses: 11 },
  { name: "C3", state: "Charging", voltage: 12.2, uses: 16 },
  { name: "2026-4", state: "Idle", voltage: 12.8, uses: 6 },
  { name: "2024-1", state: "Broken", voltage: 10.4, uses: 41 },
] as const;

/** A past public event, so the Overview has a next match to look up. */
export const DEMO_EVENT = SAFE_TEXT.event[0];

export async function loadDemo(db: Db, teamId: string) {
  const now = Math.floor(Date.now() / 1000);
  const scout = DEMO_PEOPLE[3] as DemoPerson;
  await db.insert(settings).values(withTeam(teamId, { key: "eventKey", value: DEMO_EVENT }));

  for (const [l, list] of LISTS.entries()) {
    const [row] = await db
      .insert(checklistLists)
      .values(withTeam(teamId, { name: list.name, description: SAFE_TEXT.note[l], createdAt: now }))
      .returning({ id: checklistLists.id });
    for (const [index, item] of list.items.entries()) {
      const [made] = await db
        .insert(checklistItems)
        .values(
          withTeam(teamId, {
            listId: row.id,
            index,
            type: "topic" in item ? "topic" : "item",
            name: item.name,
            checked: "checked" in item && item.checked === true,
            createdAt: now,
          }),
        )
        .returning({ id: checklistItems.id });
      if ("issue" in item && item.issue) {
        await db
          .insert(checklistIssues)
          .values(
            withTeam(teamId, { itemId: made.id, text: item.issue, createdAt: now - 2 * HOUR }),
          );
      }
    }
  }

  for (const battery of BATTERIES) {
    await db.insert(batteries).values(
      withTeam(teamId, {
        name: battery.name,
        state: battery.state,
        stateSince: (now - HOUR) * 1000,
        countingSince: (now - HOUR) * 1000,
        voltage: battery.voltage,
        useCount: battery.uses,
        createdAt: now - 90 * 24 * HOUR,
      }),
    );
  }

  // Two archives of the lists as they are, the last match's and the one before.
  const { snapshot } = await buildSnapshot(db, teamId, null);
  for (const [i, details] of ["Qual 41", "Qual 47"].entries()) {
    await db.insert(checklistArchives).values(
      withTeam(teamId, {
        event: DEMO_EVENT,
        type: "match",
        details,
        archivedAt: now - (2 - i) * 3 * HOUR,
        archivedBy: scout.id,
        archivedByName: scout.name,
        snapshot: JSON.stringify(snapshot),
      }),
    );
  }
  return { lists: LISTS.length };
}

/** The words in the demo's Pit data, for the gateway. */
export const demoWords = (): string[] => vocabularyOf(LISTS, BATTERIES);
