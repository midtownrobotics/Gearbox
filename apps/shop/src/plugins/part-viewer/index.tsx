// SPDX-License-Identifier: AGPL-3.0-only
import { PartViewerPage } from "./part-viewer-page";

export const partViewerPlugin = {
  routes: [
    {
      path: "/part/:partNumber/view",
      element: <PartViewerPage />,
    },
  ],
  navItems: [],
};
