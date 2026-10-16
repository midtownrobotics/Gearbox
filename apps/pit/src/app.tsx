import { redirectToSignIn } from "@g3/ui";
import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { plugins } from "./plugins.config";
import { BarcodeScanDisplay } from "./shared/barcode-scan-display";
import { BatteryCacheProvider } from "./shared/battery-cache-context";
import { FullscreenProvider, useFullscreen } from "./shared/fullscreen-context";
import { NavBar } from "./shared/nav-bar";
import { OfflineBanner } from "./shared/offline-banner";
import { prefetchAll } from "./shared/prefetch";
import { useAuth } from "./shared/use-auth";

function AppContent() {
  const { isFullscreen } = useFullscreen();
  // Signed out (the worker said so; not just offline, where the pit keeps working): off to sign in.
  const { signedOut } = useAuth();
  useEffect(() => {
    if (signedOut) redirectToSignIn();
  }, [signedOut]);
  const allRoutes = plugins.flatMap((p) => p.routes);
  const navItems = plugins.flatMap((p) => p.navItems ?? []).sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-1 flex-col bg-page">
      {!isFullscreen && <NavBar items={navItems} />}
      <OfflineBanner />
      <BarcodeScanDisplay />
      <Routes>
        {allRoutes.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
        {/* An address that isn't a page: the app's home. */}
        <Route path="*" element={<Navigate to="/" replace />} />
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
