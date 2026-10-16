import { Loading, Page, useIsOnline } from "@g3/ui";
import type { Plugin } from "../../shared/plugin-types";
import { useAuth } from "../../shared/use-auth";
import { ChecklistDetailPage } from "./checklist-detail-page";
import { ChecklistsPage } from "./checklists-page";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const isOnline = useIsOnline();

  if (!isOnline) {
    return (
      <Page title="Edit Checklists" width="narrow">
        <p className="text-sm text-secondary-500">You must be online to edit checklists.</p>
      </Page>
    );
  }

  if (loading) {
    return (
      <Page title="Edit Checklists" width="narrow">
        <Loading />
      </Page>
    );
  }

  if (!user) {
    return (
      <Page title="Edit Checklists" width="narrow">
        <p className="text-sm text-secondary-500">Couldn't check who's signed in. Try again.</p>
      </Page>
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
  navItems: [{ label: "Edit Checklists", to: "/editor", order: 4 }],
};
