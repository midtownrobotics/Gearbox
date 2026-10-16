import { adminPlugin } from "./plugins/admin";
import { boardPlugin } from "./plugins/board";
import { filesPlugin } from "./plugins/files";
import { leaderboardPlugin } from "./plugins/leaderboard";
import { onshapePlugin } from "./plugins/onshape";
import { overviewPlugin } from "./plugins/overview";
import { partDetailPlugin } from "./plugins/part-detail";
import { partViewerPlugin } from "./plugins/part-viewer";
import { partsPlugin } from "./plugins/parts";

export const plugins = [
  overviewPlugin,
  partsPlugin,
  partDetailPlugin,
  boardPlugin,
  filesPlugin,
  onshapePlugin,
  adminPlugin,
  leaderboardPlugin,
  partViewerPlugin,
];
