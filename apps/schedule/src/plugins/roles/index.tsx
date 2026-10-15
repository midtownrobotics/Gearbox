import type { Plugin } from "../../shared/plugin-types";
import { RolesPage } from "./roles-page";

export const rolesPlugin: Plugin = {
  name: "roles",
  routes: [{ path: "/roles", element: <RolesPage /> }],
  navItems: [{ label: "Roles", to: "/roles", order: 20, access: "editor" }],
};
