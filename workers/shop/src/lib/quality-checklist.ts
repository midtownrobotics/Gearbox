import { inTeam, withTeam } from "@g3/auth";
import { asc } from "drizzle-orm";
import type { createShopDb } from "../db";
import { qualityCheckItems } from "../db/schema";

// The checklist every quality report is answered against. It's the team's own content, edited by
// admins on the Admin page, so no migration holds one: a team that hasn't set a list gets the
// starter below the first time it needs one.

type ShopDb = ReturnType<typeof createShopDb>;

/** The list a team starts with, and what the app asked before the list was editable. */
export const STARTER_CHECKLIST = [
  "Part has the proper dimensions",
  "Part is the proper thickness",
  "Features are positioned correctly",
  "Features are the proper size",
] as const;

export const MAX_CHECKLIST_ITEMS = 20;
export const MAX_CHECK_LABEL = 120;

/** The team's checklist in order, seeding the starter the first time it's needed. */
export async function checklistFor(db: ShopDb, teamId: string): Promise<string[]> {
  const rows = await db
    .select({ label: qualityCheckItems.label })
    .from(qualityCheckItems)
    .where(inTeam(qualityCheckItems, teamId))
    .orderBy(asc(qualityCheckItems.position))
    .all();
  if (rows.length > 0) return rows.map((r) => r.label);
  await saveChecklist(db, teamId, [...STARTER_CHECKLIST]);
  return [...STARTER_CHECKLIST];
}

/**
 * Replaces the team's checklist with these labels, in this order. Reports keep the labels they
 * were answered against, so editing the list never changes what an old report says.
 */
export async function saveChecklist(db: ShopDb, teamId: string, labels: string[]): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.delete(qualityCheckItems).where(inTeam(qualityCheckItems, teamId)),
    db.insert(qualityCheckItems).values(
      withTeam(
        teamId,
        labels.map((label, position) => ({ label, position, createdAt: now })),
      ),
    ),
  ]);
}

/**
 * The labels a request is asking for, or why they won't do. One list of plain lines, each the
 * question a reporter answers about the part.
 */
export function parseChecklist(value: unknown): { labels: string[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "checklist must be a list of lines." };
  if (value.length === 0) return { error: "A checklist needs at least one line." };
  if (value.length > MAX_CHECKLIST_ITEMS) {
    return { error: `A checklist can have ${MAX_CHECKLIST_ITEMS} lines at most.` };
  }
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") return { error: "Every line has to be text." };
    const label = raw.trim();
    if (!label) return { error: "A line can't be empty." };
    if (label.length > MAX_CHECK_LABEL) {
      return { error: `A line can be ${MAX_CHECK_LABEL} characters at most.` };
    }
    if (seen.has(label.toLowerCase())) return { error: `"${label}" is in the list twice.` };
    seen.add(label.toLowerCase());
    labels.push(label);
  }
  return { labels };
}
