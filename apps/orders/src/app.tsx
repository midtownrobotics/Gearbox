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
        <div className="flex min-h-screen flex-col bg-page">
          <NavBar items={navItems} />
          <Routes>
            <Route path="/" element={<Navigate to="/requests" replace />} />
            {routes.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
          </Routes>
          <footer className="px-4 py-6 text-center text-xs text-secondary-400">
            Inspired by{" "}
            <a
              href="https://orders.frctools.com"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-secondary-700"
            >
              FRCTools.com
            </a>
          </footer>
        </div>
      </ProtectedRoute>
    </BrowserRouter>
  );
}
