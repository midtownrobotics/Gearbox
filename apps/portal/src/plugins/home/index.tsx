import type { Plugin } from "../../shared/plugin-types";
import { HomePage } from "./home-page";

export const homePlugin: Plugin = {
  name: "home",
  routes: [{ path: "/", element: <HomePage /> }],
  // The top bar is only for admins (members have the grid and nothing else): back to the grid
  // from the admin pages.
  navItems: [{ label: "Apps", to: "/", order: 0, requiresAdmin: true }],
};
