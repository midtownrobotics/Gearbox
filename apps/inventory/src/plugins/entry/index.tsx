import type { Plugin } from "../../shared/plugin-types";
import { EntryPage } from "./entry-page";

export const entryPlugin: Plugin = {
  name: "entry",
  routes: [{ path: "/items/:id", element: <EntryPage /> }],
};
