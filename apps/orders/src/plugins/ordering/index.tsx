import type { Plugin } from "../../shared/plugin-types";
import { OrderingPage } from "./ordering-page";

export const orderingPlugin: Plugin = {
  name: "ordering",
  routes: [{ path: "/ordering", element: <OrderingPage /> }],
  navItems: [{ label: "Ordering", to: "/ordering", order: 35, mentorOnly: true }],
};
