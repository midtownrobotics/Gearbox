import type { Plugin } from "../../shared/plugin-types";
import { AdminPage } from "./admin-page";

// Pit's settings moved to the team's App settings page; old links to /admin go there.
export const adminPlugin: Plugin = {
  name: "admin",
  routes: [{ path: "/admin", element: <AdminPage /> }],
};
