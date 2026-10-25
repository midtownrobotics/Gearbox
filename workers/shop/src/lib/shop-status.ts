import type { createShopDb } from "../db";
import { getSetting, setSetting } from "./settings";

// The Overview's shop status ("Raw 🥩", "Cooked 🍳", "Ash 🔥"): a word for how many parts are in
// the queue. The words and where each starts are the team's own, edited on the Admin page and kept
// as one JSON setting; a team that hasn't changed them gets the ones the app always had.

type ShopDb = ReturnType<typeof createShopDb>;

/** One status: shown while the queue has fewer than `below` parts (the last has no limit). */
export type StatusLevel = { label: string; below: number | null };

export const STATUS_LEVELS_KEY = "shop_status_levels";

export const DEFAULT_STATUS_LEVELS: StatusLevel[] = [
  { label: "Mooing Cow 🐮", below: 5 },
  { label: "Chopping Block 🔪", below: 10 },
  { label: "Raw 🥩", below: 20 },
  { label: "Rare 🍖", below: 25 },
  { label: "Cooked 🍳", below: 35 },
  { label: "Ash 🔥", below: null },
];

export const MAX_STATUS_LEVELS = 10;
export const MAX_STATUS_LABEL = 40;

/** The team's statuses, lowest first. */
export async function statusLevelsFor(db: ShopDb, teamId: string): Promise<StatusLevel[]> {
  const saved = await getSetting(db, teamId, STATUS_LEVELS_KEY);
  if (!saved) return DEFAULT_STATUS_LEVELS;
  try {
    const parsed = parseStatusLevels(JSON.parse(saved));
    return "levels" in parsed ? parsed.levels : DEFAULT_STATUS_LEVELS;
  } catch {
    return DEFAULT_STATUS_LEVELS;
  }
}

export async function saveStatusLevels(db: ShopDb, teamId: string, levels: StatusLevel[]) {
  await setSetting(db, teamId, STATUS_LEVELS_KEY, JSON.stringify(levels));
}

/**
 * The statuses a request asks for, or why they won't do: 1 to MAX_STATUS_LEVELS, each a label,
 * each but the last starting a status at a larger queue than the one before, the last unlimited.
 */
export function parseStatusLevels(value: unknown): { levels: StatusLevel[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) return { error: "Add at least one status." };
  if (value.length > MAX_STATUS_LEVELS) {
    return { error: `There can be ${MAX_STATUS_LEVELS} statuses at most.` };
  }
  const levels: StatusLevel[] = [];
  let previous = 0;
  for (const [i, raw] of value.entries()) {
    const { label, below } = (raw ?? {}) as { label?: unknown; below?: unknown };
    if (typeof label !== "string" || !label.trim()) return { error: "Every status needs a name." };
    if (label.trim().length > MAX_STATUS_LABEL) {
      return { error: `A status can be ${MAX_STATUS_LABEL} characters at most.` };
    }
    const last = i === value.length - 1;
    if (last) {
      if (below !== null) return { error: "The last status has no limit." };
    } else {
      if (typeof below !== "number" || !Number.isInteger(below) || below <= previous) {
        return {
          error: "Each status's limit has to be a whole number larger than the one before.",
        };
      }
      previous = below;
    }
    levels.push({ label: label.trim(), below: last ? null : (below as number) });
  }
  return { levels };
}
