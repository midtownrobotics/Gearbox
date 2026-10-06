import { useCallback, useMemo } from "react";
import { api, getErrorMessage } from "./api";
import type { Vendor } from "./types";
import { useLoad } from "./use-load";

const key = (vendor: string) => vendor.trim().toLowerCase();

/** Vendor profiles by name, for place-by dates and cart nudges. */
export function useVendors() {
  const { data, error, reload } = useLoad(async () => {
    const res = await api.vendors.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const byName = useMemo(() => new Map((data ?? []).map((v) => [v.key, v])), [data]);
  const vendorFor = useCallback(
    (name: string): Vendor | undefined => byName.get(key(name)),
    [byName],
  );
  return { vendors: data, error, reload, vendorFor };
}
