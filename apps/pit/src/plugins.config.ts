import { adminPlugin } from "./plugins/admin";
import { batteriesPlugin } from "./plugins/batteries";
import { checklistRunnerPlugin } from "./plugins/checklist-runner";
import { checklistsPlugin } from "./plugins/checklists";
import { homePlugin } from "./plugins/home";
import { logsPlugin } from "./plugins/logs";
import { pitMonitorPlugin } from "./plugins/pit-monitor";

export const plugins = [
  homePlugin,
  checklistRunnerPlugin,
  logsPlugin,
  checklistsPlugin,
  batteriesPlugin,
  pitMonitorPlugin,
  adminPlugin,
];
