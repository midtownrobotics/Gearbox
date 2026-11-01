// SPDX-License-Identifier: AGPL-3.0-only
import type { Plugin } from "../../shared/plugin-types";
import { ArchivesPage } from "./archives-page";

export const archivesPlugin: Plugin = {
  name: "archives",
  routes: [{ path: "/archives", element: <ArchivesPage /> }],
  navItems: [{ label: "Archives", to: "/archives", order: 2 }],
};
