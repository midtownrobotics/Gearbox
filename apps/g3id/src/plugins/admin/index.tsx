import type { Plugin } from "../../shared/plugin-types";
import { AdminAttendancePage } from "./admin-attendance-page";
import { AdminKioskPage } from "./admin-kiosk-page";
import { AdminTeamUiPage } from "./admin-team-ui-page";
import { AdminUsersPage } from "./admin-users-page";

export const adminPlugin: Plugin = {
  name: "admin",
  routes: [
    { path: "/admin/users", element: <AdminUsersPage /> },
    { path: "/admin/kiosk", element: <AdminKioskPage /> },
    { path: "/admin/attendance", element: <AdminAttendancePage /> },
    { path: "/admin/team-ui", element: <AdminTeamUiPage /> },
  ],
  navItems: [
    { label: "Users", to: "/admin/users", order: 10, audience: "admin", group: "Admin" },
    { label: "Kiosk Devices", to: "/admin/kiosk", order: 11, audience: "admin", group: "Admin" },
    { label: "Attendance", to: "/admin/attendance", order: 12, audience: "admin", group: "Admin" },
    {
      label: "Team Appearance",
      to: "/admin/team-ui",
      order: 13,
      audience: "admin",
      group: "Admin",
    },
  ],
};
