import { appUrl } from "@g3/site-config";
import { useIsOnline } from "@g3/ui";
import { useNavigate } from "react-router-dom";
import type { Plugin } from "../../shared/plugin-types";
import { useAuth } from "../../shared/use-auth";
import { ChecklistDetailPage } from "./checklist-detail-page";
import { ChecklistsPage } from "./checklists-page";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const isOnline = useIsOnline();
  const navigate = useNavigate();

  if (!isOnline) {
    return (
      <main className="min-h-screen bg-page flex items-center justify-center">
        <p className="text-gray-400">You must be online to use the editor.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-page flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </main>
    );
  }

  if (!user) {
    const loginUrl = `${appUrl("id")}/login?redirect=${encodeURIComponent(window.location.href)}`;
    return (
      <main className="min-h-screen bg-page flex flex-col items-center justify-center gap-4">
        <p className="text-gray-900 text-lg font-semibold">Sign in to use the Editor</p>
        <a
          href={loginUrl}
          className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Sign in →
        </a>
        <button
          type="button"
          onClick={() => navigate("/checklists")}
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          ← Back to Checklists
        </button>
      </main>
    );
  }

  return <>{children}</>;
}

export const checklistsPlugin: Plugin = {
  name: "checklists",
  routes: [
    {
      path: "/editor",
      element: (
        <RequireAuth>
          <ChecklistsPage />
        </RequireAuth>
      ),
    },
    {
      path: "/editor/:id",
      element: (
        <RequireAuth>
          <ChecklistDetailPage />
        </RequireAuth>
      ),
    },
  ],
  navItems: [{ label: "Editor", to: "/editor", order: 2 }],
};
