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
          <Routes>
            <Route path="/" element={<Navigate to="/requests" replace />} />
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
