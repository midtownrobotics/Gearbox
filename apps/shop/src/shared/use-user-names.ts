import { useEffect, useState } from "react";
import { fetchUserNames } from "./getters";

/**
 * Resolves a set of user IDs to display names, fetching any that aren't cached
 * yet. Returns a lookup that falls back to the raw ID until a name arrives.
 */
export function useUserNames(ids: (string | null | undefined)[]) {
  const [names, setNames] = useState<Record<string, string>>({});

  // Stable key so the effect only re-runs when the set of IDs actually changes.
  const key = [...new Set(ids.filter((id): id is string => !!id))].sort().join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run only when the ID set (key) changes; `names` is read via the functional updater
  useEffect(() => {
    const wanted = key ? key.split(",") : [];
    const missing = wanted.filter((id) => !(id in names));
    if (missing.length === 0) return;
    let canceled = false;
    fetchUserNames(missing)
      .then((rows) => {
        if (canceled) return;
        setNames((prev) => {
          const next = { ...prev };
          for (const row of rows) next[row.id] = row.displayName;
          // Mark unresolved IDs so we don't keep re-requesting them.
          for (const id of missing) if (!(id in next)) next[id] = id;
          return next;
        });
      })
      .catch(() => {
        if (canceled) return;
        setNames((prev) => {
          const next = { ...prev };
          for (const id of missing) if (!(id in next)) next[id] = id;
          return next;
        });
      });
    return () => {
      canceled = true;
    };
  }, [key]);

  return (id: string | null | undefined): string => (id ? (names[id] ?? id) : "—");
}
