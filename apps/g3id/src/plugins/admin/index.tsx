import { appUrl } from "@g3/site-config";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { Plugin } from "../../shared/plugin-types";
import { RequiresApp } from "../../shared/requires-app";
import { AdminAttendancePage } from "./admin-attendance-page";
import { AdminKioskPage } from "./admin-kiosk-page";
import { AdminUserPage } from "./admin-user-page";
import { AdminUsersPage } from "./admin-users-page";

/** A page that moved to the team's admin pages on its home (roadmap 4.5): old links go there. */
function MovedToHome({ to }: { to: string }) {
  const { search } = useLocation();
  useEffect(() => {
    window.location.replace(`${appUrl("portal")}${to}${search}`);
  }, [to, search]);
  return null;
}

export const adminPlugin: Plugin = {
  name: "admin",
  routes: [
    { path: "/admin/users", element: <AdminUsersPage /> },
    { path: "/admin/users/:id", element: <AdminUserPage /> },
    { path: "/admin/kiosk", element: <AdminKioskPage /> },
    {
      path: "/admin/attendance",
      element: (
        <RequiresApp app="attendance" name="Attendance">
          <AdminAttendancePage />
        </RequiresApp>
      ),
    },
    { path: "/admin/slack", element: <MovedToHome to="/admin/integrations" /> },
    { path: "/admin/team-ui", element: <MovedToHome to="/admin/appearance" /> },
  ],
  navItems: [
    { label: "Users", to: "/admin/users", order: 10, audience: "admin", group: "Admin" },
    {
      label: "Kiosk Devices",
      to: "/admin/kiosk",
      order: 11,
      audience: "admin",
      group: "Admin",
      signInMethod: "pin",
    },
    {
      label: "Settings",
      to: "/admin/attendance",
      order: 12,
      audience: "admin",
      group: "Admin",
      requiresApp: "attendance",
    },
  ],
};
