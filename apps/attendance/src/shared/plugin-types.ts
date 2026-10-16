import type { ReactElement } from "react";

export interface PluginRoute {
  path: string;
  element: ReactElement;
  /** Only for G3ID admins; anyone else is sent to the first page. */
  adminOnly?: boolean;
}

export interface PluginNavItem {
  label: string;
  to: string;
  order: number;
  /** Only shown to G3ID admins. */
  adminOnly?: boolean;
}

export interface Plugin {
  name: string;
  routes: PluginRoute[];
  navItems?: PluginNavItem[];
}
