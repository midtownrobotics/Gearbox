// SPDX-License-Identifier: AGPL-3.0-only
import type { Plugin } from "../../shared/plugin-types";
import { HomePage } from "./home-page";

export const homePlugin: Plugin = {
  name: "home",
  routes: [{ path: "/", element: <HomePage /> }],
  // Every signed-in member's bar: Apps (the grid) and Account; admins also get the admin pages.
  navItems: [{ label: "Apps", to: "/", order: 0, requiresAuth: true }],
};
