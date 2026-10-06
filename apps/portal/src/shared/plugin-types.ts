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
}

export interface Plugin {
  name: string;
  routes: PluginRoute[];
  navItems?: PluginNavItem[];
}
