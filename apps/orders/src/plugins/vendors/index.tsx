import type { Plugin } from "../../shared/plugin-types";
import { VendorsPage } from "./vendors-page";

export const vendorsPlugin: Plugin = {
  name: "vendors",
  routes: [{ path: "/vendors", element: <VendorsPage /> }],
  navItems: [{ label: "Vendors", to: "/vendors", order: 38, mentorOnly: true }],
};
