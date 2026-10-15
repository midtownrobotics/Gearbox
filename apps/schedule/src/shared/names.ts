// Sorting people by name. A name's last name is everything after its first space ("Mary Ann
// Smith" → "Ann Smith"); a name without a space is its own.

export type NameOrder = "first" | "last";

export const lastName = (name: string) => {
  const trimmed = name.trim();
  const space = trimmed.indexOf(" ");
  return space === -1 ? trimmed : trimmed.slice(space + 1).trim();
};

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Compares two names by first or last name, then by the whole name. */
export function compareNames(a: string, b: string, order: NameOrder): number {
  if (order === "last") {
    const byLast = collator.compare(lastName(a), lastName(b));
    if (byLast !== 0) return byLast;
  }
  return collator.compare(a, b);
}
