import type { Plugin } from "../../shared/plugin-types";
import { TreesPage } from "./trees-page";

export const treesPlugin: Plugin = {
  name: "trees",
  routes: [
    { path: "/trees", element: <TreesPage /> },
    { path: "/trees/:treeId", element: <TreesPage /> },
  ],
  navItems: [{ label: "Skill Trees", to: "/trees", order: 20 }],
};
