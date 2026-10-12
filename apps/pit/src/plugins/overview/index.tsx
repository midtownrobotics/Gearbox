import type { Plugin } from "../../shared/plugin-types";
import { OverviewPage } from "./overview-page";

export const overviewPlugin: Plugin = {
  name: "overview",
  routes: [{ path: "/", element: <OverviewPage /> }],
  navItems: [{ label: "Overview", to: "/", order: 0 }],
};
