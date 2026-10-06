import type { Plugin } from "../../shared/plugin-types";
import { ListDetailPage } from "./list-detail-page";
import { ListsPage } from "./lists-page";

export const listsPlugin: Plugin = {
  name: "lists",
  routes: [
    { path: "/lists", element: <ListsPage /> },
    { path: "/lists/:id", element: <ListDetailPage /> },
  ],
  navItems: [{ label: "Lists", to: "/lists", order: 25 }],
};
