import type { Change, Range } from "../../shared/api";
import { SLOT_MINUTES } from "../../shared/time";

// The page keeps a schedule's blocks one per slot, as the worker does, so a change can be shown
// the moment it's made; rows are drawn from them as runs of the same role.

/** Each block's role, by `cellKey`. */
export type Cells = Map<string, number>;

export const cellKey = (userId: string, day: string, slot: number) => `${userId}|${day}|${slot}`;

/** The worker's ranges, as blocks. */
export function toCells(ranges: Range[]): Cells {
  const cells: Cells = new Map();
  for (const range of ranges) {
    for (let slot = range.start; slot < range.end; slot++) {
      cells.set(cellKey(range.userId, range.day, slot), range.roleId);
    }
  }
  return cells;
}

/** One person's day as runs of the same role. */
export function rowRanges(cells: Cells, userId: string, day: string) {
  const out: { start: number; end: number; roleId: number }[] = [];
  for (let slot = 0; slot < 96; slot++) {
    const roleId = cells.get(cellKey(userId, day, slot));
    if (roleId === undefined) continue;
    const last = out[out.length - 1];
    if (last && last.roleId === roleId && last.end === slot) last.end++;
    else out.push({ start: slot, end: slot + 1, roleId });
  }
  return out;
}

/** Who else has `roleId` at some point in `[start, end)` that day. */
export function sharing(
  cells: Cells,
  userIds: string[],
  day: string,
  start: number,
  end: number,
  roleId: number,
) {
  return userIds.filter((userId) => {
    for (let slot = start; slot < end; slot++) {
      if (cells.get(cellKey(userId, day, slot)) === roleId) return true;
    }
    return false;
  });
}

/** Minutes each role has of one person's time: on `day`, or over the whole event without one. */
export function minutesByRole(cells: Cells, userId: string, day?: string): Map<number, number> {
  const prefix = day === undefined ? `${userId}|` : `${userId}|${day}|`;
  const out = new Map<number, number>();
  for (const [key, roleId] of cells) {
    if (key.startsWith(prefix)) out.set(roleId, (out.get(roleId) ?? 0) + SLOT_MINUTES);
  }
  return out;
}

/**
 * The changes that put back what `change` replaces: for each person, runs of the blocks' roles
 * as they are now (null where nothing is assigned). For undo.
 */
export function inverseOf(cells: Cells, change: Change): Change[] {
  const out: Change[] = [];
  for (const userId of change.userIds) {
    let run: Change | null = null;
    for (let slot = change.start; slot < change.end; slot++) {
      const roleId = cells.get(cellKey(userId, change.day, slot)) ?? null;
      if (run && run.roleId === roleId && run.end === slot) run.end++;
      else {
        run = { userIds: [userId], day: change.day, start: slot, end: slot + 1, roleId };
        out.push(run);
      }
    }
  }
  return out;
}
