import type { Plugin } from "../../shared/plugin-types";
import { PitMonitorPage } from "./pit-monitor-page";

export const pitMonitorPlugin: Plugin = {
  name: "pit-monitor",
  routes: [{ path: "/monitor", element: <PitMonitorPage /> }],
  navItems: [{ label: "Monitor", to: "/monitor", order: 5 }],
};
