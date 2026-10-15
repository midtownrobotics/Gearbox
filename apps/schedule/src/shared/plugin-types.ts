import type { ReactElement } from "react";

export interface PluginRoute {
  path: string;
  element: ReactElement;
}

/** Who a page is for: everyone signed in, editors (mentors, admins, trusted students), mentors. */
export type Access = "everyone" | "editor" | "mentor";

export interface PluginNavItem {
  label: string;
  to: string;
  order: number;
  /** Who sees it in the bar. Everyone when left out. */
  access?: Access;
}

export interface Plugin {
  name: string;
  routes: PluginRoute[];
  navItems?: PluginNavItem[];
}
