import { Navigate, useLocation } from "react-router-dom";
import type { Plugin } from "../../shared/plugin-types";
import { SettingsPage } from "./settings-page";

/** The page was at /settings: links saved before it moved still open it, with what they carried. */
function OldAddress() {
  const { search } = useLocation();
  return <Navigate to={`/admin${search}`} replace />;
}

export const settingsPlugin: Plugin = {
  name: "settings",
  routes: [
    { path: "/admin", element: <SettingsPage /> },
    { path: "/settings", element: <OldAddress /> },
  ],
  navItems: [{ label: "Admin", to: "/admin", order: 50, mentorOnly: true }],
};
