import type { Plugin } from "../../shared/plugin-types";
import { AdminPage } from "./admin-page";

export const adminPlugin: Plugin = {
  name: "admin",
  routes: [{ path: "/admin", element: <AdminPage /> }],
  navItems: [{ label: "Admin", to: "/admin", order: 5, requiresAdmin: true }],
};
