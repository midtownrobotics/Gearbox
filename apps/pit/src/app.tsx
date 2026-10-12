import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { plugins } from "./plugins.config";
import { BarcodeScanDisplay } from "./shared/barcode-scan-display";
import { BatteryCacheProvider } from "./shared/battery-cache-context";
import { FullscreenProvider, useFullscreen } from "./shared/fullscreen-context";
import { NavBar } from "./shared/nav-bar";
import { OfflineBanner } from "./shared/offline-banner";
import { prefetchAll } from "./shared/prefetch";

function AppContent() {
  const { isFullscreen } = useFullscreen();
  const allRoutes = plugins.flatMap((p) => p.routes);
  const navItems = plugins.flatMap((p) => p.navItems ?? []).sort((a, b) => a.order - b.order);

  return (
    <div className="flex min-h-screen flex-col bg-page">
      {!isFullscreen && <NavBar items={navItems} />}
      <OfflineBanner />
      <BarcodeScanDisplay />
      <Routes>
        {allRoutes.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
      </Routes>
    </div>
  );
}

export function App() {
  useEffect(() => {
    prefetchAll().catch(() => {});
  }, []);

  return (
    <BatteryCacheProvider>
      <FullscreenProvider>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </FullscreenProvider>
    </BatteryCacheProvider>
  );
}
