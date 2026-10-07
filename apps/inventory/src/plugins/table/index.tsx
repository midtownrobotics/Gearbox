import type { Plugin } from "../../shared/plugin-types";
import { NewEntryPage } from "./new-entry-page";
import { TablePage } from "./table-page";

export const tablePlugin: Plugin = {
  name: "table",
  routes: [
    { path: "/inventory", element: <TablePage /> },
    { path: "/new", element: <NewEntryPage /> },
  ],
  navItems: [
    { label: "Inventory", to: "/inventory", order: 10 },
    { label: "Add an entry", to: "/new", order: 20 },
  ],
};
