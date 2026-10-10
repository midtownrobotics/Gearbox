import type { ReactElement } from "react";

export interface PluginRoute {
  path: string;
  element: ReactElement;
}

export interface PluginNavItem {
  label: string;
  to: string;
  order: number;
  requiresAuth?: boolean;
  /** Only shown to the team's admins. */
  requiresAdmin?: boolean;
  /** Only shown to the team's mentors and admins. */
  requiresMentor?: boolean;
  /** Items with the same group are shown together under its name. */
  group?: string;
}

export interface Plugin {
  name: string;
  routes: PluginRoute[];
  navItems?: PluginNavItem[];
}
