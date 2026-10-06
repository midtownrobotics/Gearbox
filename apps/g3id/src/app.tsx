import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { plugins } from "./plugins.config";
import { NavBar } from "./shared/nav-bar";
import { RedirectInfo } from "./shared/redirect-info";

function AppContent() {
  const allRoutes = plugins.flatMap((p) => p.routes);
  const navItems = plugins.flatMap((p) => p.navItems ?? []).sort((a, b) => a.order - b.order);
  const location = useLocation();
  const hideNavBar = location.pathname.startsWith("/kiosk/");

  return (
    <div className="flex flex-col min-h-screen bg-page">
      {!hideNavBar && <NavBar items={navItems} />}
      <RedirectInfo />
      <div className="flex flex-col flex-1">
        <Routes>
          {allRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
        </Routes>
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
