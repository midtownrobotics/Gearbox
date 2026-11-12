// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, createContext, useContext, useState } from "react";
import type { Battery } from "./getters/types";

type BatteryCacheContextType = {
  batteries: Battery[];
  setBatteries: (batteries: Battery[]) => void;
  getBatteryName: (id: number) => string;
};

const BatteryCacheContext = createContext<BatteryCacheContextType | null>(null);

export function BatteryCacheProvider({ children }: { children: ReactNode }) {
  const [batteries, setBatteries] = useState<Battery[]>([]);

  const getBatteryName = (id: number): string => {
    const battery = batteries.find((b) => b.id === id);
    return battery?.name || `BAT-${String(id).padStart(4, "0")}`;
  };

  return (
    <BatteryCacheContext.Provider value={{ batteries, setBatteries, getBatteryName }}>
      {children}
    </BatteryCacheContext.Provider>
  );
}

export function useBatteryCache() {
  const context = useContext(BatteryCacheContext);
  if (!context) {
    throw new Error("useBatteryCache must be used within BatteryCacheProvider");
  }
  return context;
}
