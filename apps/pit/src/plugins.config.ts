import { adminPlugin } from "./plugins/admin";
import { archivesPlugin } from "./plugins/archives";
import { batteriesPlugin } from "./plugins/batteries";
import { checklistRunnerPlugin } from "./plugins/checklist-runner";
import { checklistsPlugin } from "./plugins/checklists";
import { logsPlugin } from "./plugins/logs";
import { overviewPlugin } from "./plugins/overview";
import { pitMonitorPlugin } from "./plugins/pit-monitor";

export const plugins = [
  overviewPlugin,
  checklistRunnerPlugin,
  archivesPlugin,
  logsPlugin,
  checklistsPlugin,
  batteriesPlugin,
  pitMonitorPlugin,
  adminPlugin,
];
