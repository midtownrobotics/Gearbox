import type { Plugin } from "../../shared/plugin-types";
import { SettingsPage } from "./settings-page";

export const settingsPlugin: Plugin = {
  name: "settings",
  routes: [{ path: "/settings", element: <SettingsPage /> }],
  navItems: [{ label: "Settings", to: "/settings", order: 50, mentorOnly: true }],
};
