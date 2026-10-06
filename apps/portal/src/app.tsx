import { BrowserRouter, Route, Routes } from "react-router-dom";
import { plugins } from "./plugins.config";
import { NavBar } from "./shared/nav-bar";

export function App() {
  const allRoutes = plugins.flatMap((p) => p.routes);
  const navItems = plugins.flatMap((p) => p.navItems ?? []).sort((a, b) => a.order - b.order);

  return (
    <BrowserRouter>
      <NavBar items={navItems} />
      <Routes>
        {allRoutes.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
      </Routes>
    </BrowserRouter>
  );
}
