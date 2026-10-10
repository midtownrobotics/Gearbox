import type { ReactNode } from "react";
import type { Plugin } from "../../shared/plugin-types";
import { AdminOnly } from "./admin-only";
import { AppearancePage } from "./appearance-page";
import { AppsPage } from "./apps-page";
import { IntegrationsPage } from "./integrations-page";
import { SettingsPage } from "./settings-page";
import { SignInPage } from "./sign-in-page";
import { SlackPage } from "./slack-page";

// The team's admin pages (roadmap 4.5), on its home: <number>.<platform>/admin. Apps is the
// platform's (which apps the team has on); App settings are each app's own (its /team-settings,
// in forms built from its manifest); Appearance, Sign-in and Slack are G3ID's settings; and
// Integrations shows what each app is connected to.

const admin = (element: ReactNode) => <AdminOnly>{element}</AdminOnly>;

export const adminPlugin: Plugin = {
  name: "admin",
  routes: [
    { path: "/admin", element: admin(<AppsPage />) },
    { path: "/admin/settings", element: admin(<SettingsPage />) },
    { path: "/admin/appearance", element: admin(<AppearancePage />) },
    { path: "/admin/sign-in", element: admin(<SignInPage />) },
    { path: "/admin/slack", element: admin(<SlackPage />) },
    { path: "/admin/integrations", element: admin(<IntegrationsPage />) },
  ],
  navItems: [
    { label: "Manage apps", to: "/admin", order: 10, requiresAdmin: true, group: "Admin" },
    {
      label: "App settings",
      to: "/admin/settings",
      order: 11,
      requiresAdmin: true,
      group: "Admin",
    },
    {
      label: "Appearance",
      to: "/admin/appearance",
      order: 12,
      requiresAdmin: true,
      group: "Admin",
    },
    { label: "Sign-in", to: "/admin/sign-in", order: 13, requiresAdmin: true, group: "Admin" },
    { label: "Slack", to: "/admin/slack", order: 14, requiresAdmin: true, group: "Admin" },
    {
      label: "Integrations",
      to: "/admin/integrations",
      order: 15,
      requiresAdmin: true,
      group: "Admin",
    },
  ],
};
