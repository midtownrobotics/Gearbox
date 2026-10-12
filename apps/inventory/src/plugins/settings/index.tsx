import { Navigate } from "react-router-dom";
import type { Plugin } from "../../shared/plugin-types";
import { SettingsPage } from "./settings-page";

export const settingsPlugin: Plugin = {
  name: "settings",
  routes: [
    { path: "/admin", element: <SettingsPage /> },
    // Where the page was: links saved before it moved still open it.
    { path: "/settings", element: <Navigate to="/admin" replace /> },
  ],
  navItems: [{ label: "Admin", to: "/admin", order: 90, adminOnly: true }],
};
