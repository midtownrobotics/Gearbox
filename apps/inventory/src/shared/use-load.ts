import { type DependencyList, useEffect, useState } from "react";

/** Loads data on mount (and when deps change). `reload` refetches without clearing. */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: callers pass their own deps
  useEffect(() => {
    let canceled = false;
    load()
      .then((value) => {
        if (!canceled) {
          setData(value);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!canceled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      canceled = true;
    };
  }, [...deps, version]);

  return { data, error, reload: () => setVersion((v) => v + 1) };
}
