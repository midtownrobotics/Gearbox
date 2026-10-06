import type { ReactElement } from "react";

export interface PluginRoute {
  path: string;
  element: ReactElement;
}

export interface PluginNavItem {
  label: string;
  to: string;
  order: number;
  /** Who sees it: signed-in people (default), signed-out people, or admins. */
  audience?: "signed-in" | "signed-out" | "admin";
  /** Items with the same group sit together in the navbar. */
  group?: string;
}

export interface Plugin {
  name: string;
  routes: PluginRoute[];
  navItems?: PluginNavItem[];
}
