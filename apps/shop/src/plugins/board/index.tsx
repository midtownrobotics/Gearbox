// SPDX-License-Identifier: AGPL-3.0-only
import type { Plugin } from "../../shared/plugin-types";
import { BoardPage } from "./board-page";

export const boardPlugin: Plugin = {
  name: "board",
  routes: [
    { path: "/board", element: <BoardPage /> },
    { path: "/board/process/:processId", element: <BoardPage /> },
  ],
  navItems: [{ label: "Shop Floor", to: "/board", order: 2 }],
};
