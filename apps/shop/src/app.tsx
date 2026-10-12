import { BrowserRouter, Route, Routes } from "react-router-dom";
import { plugins } from "./plugins.config";
import { BoardPage } from "./plugins/board/board-page";
import { NavBar } from "./shared/nav-bar";
import { ProtectedRoute } from "./shared/protected-route";
import { useKiosk } from "./shared/use-auth";
import { VersionFooter } from "./shared/version-footer";

export function App() {
  return (
    <BrowserRouter>
      <ProtectedRoute>
        <AppContent />
      </ProtectedRoute>
    </BrowserRouter>
  );
}

// Must render inside ProtectedRoute — that's what provides the user useKiosk reads.
function AppContent() {
  const kiosk = useKiosk();
  const navItems = plugins.flatMap((p) => p.navItems ?? []).sort((a, b) => a.order - b.order);

  // BoardPage locks itself to the kiosk's machine, or shows the selectable overview if unmatched.
  if (kiosk.active) {
    return (
      <div className="flex min-h-screen flex-col bg-page">
        <NavBar items={navItems} />
        <BoardPage />
      </div>
    );
  }

  const allRoutes = plugins.flatMap((p) => p.routes);
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <NavBar items={navItems} />
      <Routes>
        {allRoutes.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
      </Routes>
      <VersionFooter />
    </div>
  );
}
