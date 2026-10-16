import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { plugins } from "./plugins.config";
import { ProtectedRoute } from "./shared/auth";
import { NavBar } from "./shared/nav-bar";

export function App() {
  const routes = plugins.flatMap((p) => p.routes);
  const navItems = plugins.flatMap((p) => p.navItems ?? []).sort((a, b) => a.order - b.order);
  return (
    <BrowserRouter>
      <ProtectedRoute>
        <div className="flex flex-1 flex-col bg-page">
          <NavBar items={navItems} />
          <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-4">
            <p className="text-amber-900 text-sm bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5">
              Edge isn't fully ready for other teams yet. It's built around one shop's box, so some
              parts may not work for your team.
            </p>
          </div>
          <Routes>
            <Route path="/" element={<Navigate to="/network" replace />} />
            {routes.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
            {/* An address that isn't a page: the app's home. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </ProtectedRoute>
    </BrowserRouter>
  );
}
