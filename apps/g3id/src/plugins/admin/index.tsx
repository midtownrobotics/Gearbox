import { MovedToHome } from "../../shared/moved-to-home";
import type { Plugin } from "../../shared/plugin-types";
export const adminPlugin: Plugin = {
  name: "admin",
  routes: [
    { path: "/admin", element: <MovedToHome to="/admin/permissions" /> },
    { path: "/admin/permissions", element: <MovedToHome /> },
    { path: "/admin/users", element: <MovedToHome /> },
    { path: "/admin/users/:id", element: <MovedToHome /> },
    { path: "/admin/kiosk", element: <MovedToHome /> },
    { path: "/admin/attendance", element: <MovedToHome /> },
    { path: "/admin/slack", element: <MovedToHome to="/admin/integrations" /> },
    { path: "/admin/team-ui", element: <MovedToHome to="/admin/appearance" /> },
  ],
};
