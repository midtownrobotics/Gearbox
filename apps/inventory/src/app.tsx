import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { plugins } from "./plugins.config";
import { ProtectedRoute } from "./shared/auth";
import { InventoryDataProvider } from "./shared/inventory-data";
import { NavBar } from "./shared/nav-bar";

export function App() {
  const routes = plugins.flatMap((p) => p.routes);
  const navItems = plugins.flatMap((p) => p.navItems ?? []).sort((a, b) => a.order - b.order);
  return (
    <BrowserRouter>
      <ProtectedRoute>
        <div className="flex min-h-screen flex-col bg-page">
          <NavBar items={navItems} />
          <InventoryDataProvider>
            <Routes>
              <Route path="/" element={<Navigate to="/inventory" replace />} />
              {routes.map((r) => (
                <Route key={r.path} path={r.path} element={r.element} />
              ))}
              <Route path="*" element={<Navigate to="/inventory" replace />} />
            </Routes>
          </InventoryDataProvider>
        </div>
      </ProtectedRoute>
    </BrowserRouter>
  );
}
