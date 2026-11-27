// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The quantity box is kept as text. A typed number is saved on Enter or blur, since its digits
 * arrive one at a time. A step from the up/down arrows (or the arrow keys) is saved shortly after
 * the last step, because a click on Firefox's arrows doesn't focus the box, so no blur follows.
 * These helpers hold the parsing and the save decision so they can be tested without a browser.
 */

export type ParsedQuantity = { ok: true; value: number } | { ok: false };
export type QuantityPatch =
  | { kind: "save"; quantity: number }
  | { kind: "none" }
  | { kind: "error" };

/** Parse what is typed into the quantity box: a whole number from 0 to a million. */
export function parseQuantity(text: string): ParsedQuantity {
  // Only digits: Number() would also take "1e3", "0x10" or " 1.0".
  if (!/^\d+$/.test(text.trim())) return { ok: false };
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return { ok: false };
  return { ok: true, value: n };
}

/** Decide what a change to the quantity text should do relative to the stored quantity. */
export function quantityPatch(parsed: ParsedQuantity, stored: number): QuantityPatch {
  if (!parsed.ok) return { kind: "error" };
  if (parsed.value === stored) return { kind: "none" };
  return { kind: "save", quantity: parsed.value };
}

/**
 * Whether an `input` event's change was a step (the arrows, or the arrow keys) rather than
 * typing, pasting, deleting or undo. Typing gives an `inputType` such as "insertText" or
 * "deleteContentBackward"; a step gives none.
 */
export function isStep(inputType: string | undefined): boolean {
  return !inputType || !/^(insert|delete|history)/.test(inputType);
}
