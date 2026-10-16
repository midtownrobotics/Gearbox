import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { plugins } from "./plugins.config";
import { OpenClosest } from "./plugins/schedules/open-closest";
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
          <Routes>
            {/* Opening the app: the schedule closest to now. */}
            <Route path="/" element={<OpenClosest />} />
            {routes.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
            <Route path="*" element={<Navigate to="/schedules/all" replace />} />
          </Routes>
        </div>
      </ProtectedRoute>
    </BrowserRouter>
  );
}
