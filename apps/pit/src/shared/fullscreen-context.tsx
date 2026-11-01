// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, createContext, useContext, useState } from "react";

type FullscreenContextType = {
  isFullscreen: boolean;
  setFullscreen: (value: boolean) => void;
};

const FullscreenContext = createContext<FullscreenContextType | null>(null);

export function FullscreenProvider({ children }: { children: ReactNode }) {
  const [isFullscreen, setFullscreen] = useState(false);

  return (
    <FullscreenContext.Provider value={{ isFullscreen, setFullscreen }}>
      {children}
    </FullscreenContext.Provider>
  );
}

export function useFullscreen() {
  const context = useContext(FullscreenContext);
  if (!context) {
    throw new Error("useFullscreen must be used within FullscreenProvider");
  }
  return context;
}
