import type { Plugin } from "../../shared/plugin-types";
import { LocationsPage } from "./locations-page";

export const locationsPlugin: Plugin = {
  name: "locations",
  routes: [{ path: "/locations", element: <LocationsPage /> }],
  navItems: [{ label: "Locations", to: "/locations", order: 15 }],
};
