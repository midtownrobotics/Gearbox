import type { FieldView, ItemView } from "@g3/worker-inventory";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, getErrorMessage } from "./api";
import { type Places, indexPlaces } from "./places";
import { ErrorBanner, Page, PageLoading } from "./ui";

// Everything the pages show, loaded once and shared: the entries with their stock, and the team's
// fields and places. Fetched again when the tab is looked at and every minute while it stays open,
// so a count or a check-out made on another device shows up.

const REFRESH_MS = 60_000;

type InventoryData = {
  fields: FieldView[];
  items: ItemView[];
  places: Places;
  reload: () => Promise<void>;
};

const InventoryDataContext = createContext<InventoryData | null>(null);

export function useInventory(): InventoryData {
  const data = useContext(InventoryDataContext);
  if (!data) throw new Error("useInventory must be used inside InventoryDataProvider");
  return data;
}

async function fetchInventory() {
  const res = await api.inventory.$get();
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

export function InventoryDataProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof fetchInventory>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => setLoaded(await fetchInventory()), []);

  useEffect(() => {
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [reload]);

  useEffect(() => {
    // A failed refresh keeps what is on screen; the next one tries again.
    const refresh = () => {
      if (document.visibilityState === "visible") reload().catch(() => {});
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [reload]);

  const value = useMemo(
    () =>
      loaded
        ? {
            fields: loaded.fields,
            items: loaded.items,
            places: indexPlaces(loaded.locations, loaded.robots, loaded.subsystems),
            reload,
          }
        : null,
    [loaded, reload],
  );

  if (error) {
    return (
      <Page title="Inventory">
        <ErrorBanner message={error} />
      </Page>
    );
  }
  if (!value) return <PageLoading />;
  return <InventoryDataContext.Provider value={value}>{children}</InventoryDataContext.Provider>;
}
