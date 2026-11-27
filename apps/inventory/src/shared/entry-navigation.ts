// SPDX-License-Identifier: AGPL-3.0-only

export type EntryNavigationState = {
  from: string;
  fromState?: unknown;
};

export type EntryBackTarget = {
  to: string;
  state?: unknown;
};

/** Restore the page that opened an entry, or use Inventory for a direct URL visit. */
export function entryBackTarget(state: unknown): EntryBackTarget {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { to: "/inventory" };
  }

  const navigation = state as Partial<EntryNavigationState>;
  const from = navigation.from;
  if (
    typeof from !== "string" ||
    !from.startsWith("/") ||
    from.startsWith("//") ||
    from.includes("\\")
  ) {
    return { to: "/inventory" };
  }

  return navigation.fromState === undefined
    ? { to: from }
    : { to: from, state: navigation.fromState };
}
