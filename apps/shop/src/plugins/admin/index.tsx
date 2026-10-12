import { Navigate } from "react-router-dom";
import type { Plugin } from "../../shared/plugin-types";
import { AdminPage } from "./admin-page";

export const adminPlugin: Plugin = {
  name: "admin",
  routes: [
    { path: "/admin", element: <AdminPage /> },
    // Admin replaced Settings; keep old links working.
    { path: "/settings", element: <Navigate to="/admin" replace /> },
  ],
  navItems: [{ label: "Admin", to: "/admin", order: 5 }],
};
