import { Moved } from "../../shared/moved";
import type { Plugin } from "../../shared/plugin-types";
import { AdminKioskPage } from "./admin-kiosk-page";
import { AdminUserPage } from "./admin-user-page";
import { AdminUsersPage } from "./admin-users-page";

export const adminPlugin: Plugin = {
  name: "admin",
  routes: [
    { path: "/admin/users", element: <AdminUsersPage /> },
    { path: "/admin/users/:id", element: <AdminUserPage /> },
    { path: "/admin/kiosk", element: <AdminKioskPage /> },
    // Pages that moved: to the team's admin pages on its home (roadmap 4.5), and to Attendance.
    { path: "/admin/slack", element: <Moved app="portal" to="/admin/integrations" /> },
    { path: "/admin/team-ui", element: <Moved app="portal" to="/admin/appearance" /> },
    { path: "/admin/attendance", element: <Moved app="attendance" to="/admin" /> },
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
  ],
};
