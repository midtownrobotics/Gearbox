import { useTeamUiSettings } from "@g3/ui";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import ConfirmPage from "./kiosk/ConfirmPage";
import { KIOSKS, KioskGate } from "./kiosk/kiosk-gate";
import { plugins } from "./plugins.config";
import { ProtectedRoute, useAuthUser } from "./shared/auth";
import { NavBar } from "./shared/nav-bar";
import type { PluginRoute } from "./shared/plugin-types";

const FIRST_PAGE = "/leaderboard";

/** An admin page: anyone else is sent to the first page. */
function AdminOnly({ route }: { route: PluginRoute }) {
  const user = useAuthUser();
  if (route.adminOnly && !user.isAdmin) return <Navigate to={FIRST_PAGE} replace />;
  return route.element;
}

/** The app's own pages, under the shared bar. */
function AppPages() {
  const routes = plugins.flatMap((p) => p.routes);
  const navItems = plugins.flatMap((p) => p.navItems ?? []).sort((a, b) => a.order - b.order);
  return (
    <ProtectedRoute>
      <div className="flex min-h-screen flex-col bg-page">
        <NavBar items={navItems} />
        <Routes>
          <Route path="/" element={<Navigate to={FIRST_PAGE} replace />} />
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={<AdminOnly route={r} />} />
          ))}
          <Route path="*" element={<Navigate to={FIRST_PAGE} replace />} />
        </Routes>
      </div>
    </ProtectedRoute>
  );
}

export default function App() {
  // The team's appearance and name (its tab title too), from its Team Appearance settings.
  useTeamUiSettings();
  const params = new URLSearchParams(window.location.search);
  const action = params.get("action");
  const w = params.get("w");

  // Member scanned the kiosk QR → confirm sign-in/out as their G3ID identity.
  if ((action === "signin" || action === "signout") && w) {
    return <ConfirmPage action={action} w={w} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* The QR code displays: full screen, with no bar. */}
        {Object.entries(KIOSKS).map(([path, types]) => (
          <Route key={path} path={path} element={<KioskGate key={path} types={types} />} />
        ))}
        <Route path="*" element={<AppPages />} />
      </Routes>
    </BrowserRouter>
  );
}
