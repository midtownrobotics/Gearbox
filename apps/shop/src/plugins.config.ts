import { adminPlugin } from "./plugins/admin";
import { boardPlugin } from "./plugins/board";
import { filesPlugin } from "./plugins/files";
import { homePlugin } from "./plugins/home";
import { leaderboardPlugin } from "./plugins/leaderboard";
import { partDetailPlugin } from "./plugins/part-detail";
import { partViewerPlugin } from "./plugins/part-viewer";
import { partsPlugin } from "./plugins/parts";

export const plugins = [
  homePlugin,
  partsPlugin,
  partDetailPlugin,
  boardPlugin,
  filesPlugin,
  adminPlugin,
  leaderboardPlugin,
  partViewerPlugin,
];
