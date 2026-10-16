import type { Plugin } from "../../shared/plugin-types";
import { BatteriesPage } from "./batteries-page";

export const batteriesPlugin: Plugin = {
  name: "batteries",
  routes: [{ path: "/batteries", element: <BatteriesPage /> }],
  navItems: [{ label: "Batteries", to: "/batteries", order: 4 }],
};
