import type { Plugin } from "../../shared/plugin-types";
import { ReceivingPage } from "./receiving-page";

export const receivingPlugin: Plugin = {
  name: "receiving",
  routes: [{ path: "/receiving", element: <ReceivingPage /> }],
  navItems: [{ label: "Deliveries", to: "/receiving", order: 36 }],
};
