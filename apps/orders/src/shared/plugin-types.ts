import type { ReactElement } from "react";

export interface PluginRoute {
  path: string;
  element: ReactElement;
}

export interface PluginNavItem {
  label: string;
  to: string;
  order: number;
  /** The module this item belongs to (e.g. "Orders"); items are grouped under it. */
  group?: string;
  /** Only shown to mentors. */
  mentorOnly?: boolean;
}

export interface Plugin {
  name: string;
  routes: PluginRoute[];
  navItems?: PluginNavItem[];
}
