import type { Plugin } from "../../shared/plugin-types";
import { AdminPage } from "./admin-page";

export const adminPlugin: Plugin = {
  name: "admin",
  routes: [{ path: "/admin", element: <AdminPage />, adminOnly: true }],
  navItems: [{ label: "Admin", to: "/admin", order: 90, adminOnly: true }],
};
