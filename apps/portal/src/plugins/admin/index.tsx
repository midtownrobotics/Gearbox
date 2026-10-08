import type { Plugin } from "../../shared/plugin-types";
import { AdminOnly } from "./admin-only";
import { AppearancePage } from "./appearance-page";
import { AppsPage } from "./apps-page";
import { SlackPage } from "./slack-page";

// The team's admin pages (roadmap 4.5), on its home: <number>.<platform>/admin. Apps is the
// platform's (which apps the team has on); Appearance and Slack are G3ID's settings, moved here
// from G3ID's admin pages.
export const adminPlugin: Plugin = {
  name: "admin",
  routes: [
    {
      path: "/admin",
      element: (
        <AdminOnly>
          <AppsPage />
        </AdminOnly>
      ),
    },
    {
      path: "/admin/appearance",
      element: (
        <AdminOnly>
          <AppearancePage />
        </AdminOnly>
      ),
    },
    {
      path: "/admin/slack",
      element: (
        <AdminOnly>
          <SlackPage />
        </AdminOnly>
      ),
    },
  ],
  navItems: [
    { label: "Apps", to: "/admin", order: 10, requiresAdmin: true, group: "Admin" },
    {
      label: "Appearance",
      to: "/admin/appearance",
      order: 11,
      requiresAdmin: true,
      group: "Admin",
    },
    { label: "Slack", to: "/admin/slack", order: 12, requiresAdmin: true, group: "Admin" },
  ],
};
