import { Navigate, useSearchParams } from "react-router-dom";
import type { Plugin } from "../../shared/plugin-types";
import { RequiresApp } from "../../shared/requires-app";
import { AdminOnly } from "../admin/admin-only";
import { AdminAttendancePage } from "./admin-attendance-page";
import { AdminKioskPage } from "./admin-kiosk-page";
import { AdminUserPage } from "./admin-user-page";
import { AdminUsersPage } from "./admin-users-page";

function PermissionsMoved() {
  const [params] = useSearchParams();
  const member = params.get("member");
  return (
    <Navigate to={member ? `/admin/users/${encodeURIComponent(member)}` : "/admin/users"} replace />
  );
}
export const usersPlugin: Plugin = {
  name: "users",
  routes: [
    {
      path: "/admin/users",
      element: (
        <AdminOnly>
          <AdminUsersPage />
        </AdminOnly>
      ),
    },
    {
      path: "/admin/users/:id",
      element: (
        <AdminOnly>
          <AdminUserPage />
        </AdminOnly>
      ),
    },
    {
      path: "/admin/permissions",
      element: (
        <AdminOnly>
          <PermissionsMoved />
        </AdminOnly>
      ),
    },
    {
      path: "/admin/kiosk",
      element: (
        <AdminOnly>
          <AdminKioskPage />
        </AdminOnly>
      ),
    },
    {
      path: "/admin/attendance",
      element: (
        <RequiresApp app="attendance" name="Attendance">
          <AdminAttendancePage />
        </RequiresApp>
      ),
    },
  ],
  navItems: [
    { label: "Users", to: "/admin/users", order: 8, requiresAdmin: true, group: "Admin" },
    { label: "Kiosk Devices", to: "/admin/kiosk", order: 9, requiresAdmin: true, group: "Admin" },
    {
      label: "Attendance",
      to: "/admin/attendance",
      order: 9.5,
      requiresAuth: true,
      requiresApp: "attendance",
      permission: { app: "attendance", key: "manage" },
      group: "Admin",
    },
  ],
};
