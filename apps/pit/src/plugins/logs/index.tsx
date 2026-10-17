import type { Plugin } from "../../shared/plugin-types";
import { AdvantageScopePage } from "./advantagescope-page";
import { LogsPage } from "./logs-page";

export const logsPlugin: Plugin = {
  name: "logs",
  routes: [
    { path: "/logs", element: <LogsPage /> },
    // Under Logs, which stays the bar's current page.
    { path: "/logs/advantagescope", element: <AdvantageScopePage /> },
  ],
  navItems: [{ label: "Logs", to: "/logs", order: 6 }],
};
