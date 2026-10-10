import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Plugin } from "../../shared/plugin-types";
import { AdminOnly } from "./admin-only";
import { AppearancePage } from "./appearance-page";
import { AppsPage } from "./apps-page";
import { IntegrationsPage } from "./integrations-page";
import { SignInPage } from "./sign-in-page";

// The team's admin pages (roadmap 4.5), on its home: <number>.<platform>/admin. Only what's the
// whole team's lives here: Apps is the platform's (which apps the team has on); Appearance and
// Sign-in are G3ID's settings; and Integrations connects Slack (G3ID's) and shows what else each
// app is connected to. A setting for one app stays on that app's own pages.

const admin = (element: ReactNode) => <AdminOnly>{element}</AdminOnly>;

/** Slack had its own page; it's on Integrations now (old links, and Slack's ?connected/?error). */
function SlackMoved() {
  const { search } = useLocation();
  return <Navigate to={`/admin/integrations${search}`} replace />;
}

export const adminPlugin: Plugin = {
  name: "admin",
  routes: [
    { path: "/admin", element: admin(<AppsPage />) },
    { path: "/admin/appearance", element: admin(<AppearancePage />) },
    { path: "/admin/sign-in", element: admin(<SignInPage />) },
    { path: "/admin/slack", element: <SlackMoved /> },
    { path: "/admin/integrations", element: admin(<IntegrationsPage />) },
  ],
  navItems: [
    { label: "Manage apps", to: "/admin", order: 10, requiresAdmin: true, group: "Admin" },
    {
      label: "Appearance",
      to: "/admin/appearance",
      order: 12,
      requiresAdmin: true,
      group: "Admin",
    },
    { label: "Sign-in", to: "/admin/sign-in", order: 13, requiresAdmin: true, group: "Admin" },
    {
      label: "Integrations",
      to: "/admin/integrations",
      order: 15,
      requiresAdmin: true,
      group: "Admin",
    },
  ],
};
