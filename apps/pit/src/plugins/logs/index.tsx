import type { Plugin } from "../../shared/plugin-types";
import { LogsPage } from "./logs-page";

export const logsPlugin: Plugin = {
  name: "logs",
  routes: [{ path: "/logs", element: <LogsPage /> }],
  navItems: [{ label: "Logs", to: "/logs", order: 2 }],
};
