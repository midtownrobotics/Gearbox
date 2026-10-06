import type { Plugin } from "../../shared/plugin-types";
import { CatalogPage } from "./catalog-page";

export const catalogPlugin: Plugin = {
  name: "catalog",
  routes: [{ path: "/catalog", element: <CatalogPage /> }],
  navItems: [{ label: "Catalog", to: "/catalog", order: 5 }],
};
