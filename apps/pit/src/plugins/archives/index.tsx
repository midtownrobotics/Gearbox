import type { Plugin } from "../../shared/plugin-types";
import { ArchivesPage } from "./archives-page";

export const archivesPlugin: Plugin = {
  name: "archives",
  routes: [{ path: "/archives", element: <ArchivesPage /> }],
  navItems: [{ label: "Archives", to: "/archives", order: 2 }],
};
