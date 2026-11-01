import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Plugin } from "../../shared/plugin-types";
import { AdminOnly } from "./admin-only";
import { AppearancePage } from "./appearance-page";
import { AppsPage } from "./apps-page";
import { IntegrationsPage } from "./integrations-page";
import { KiosksPage } from "./kiosks-page";
import { LogPage } from "./log-page";
import { MemberPage } from "./member-page";
import { MembersPage } from "./members-page";
import { NotificationsPage } from "./notifications-page";
import { OperatorAccessPage } from "./operator-access-page";
import { SignInPage } from "./sign-in-page";

// The team's admin pages (roadmap 4.5), on its home: <number>.<platform>/admin. Only what's the
// whole team's lives here: Apps is the platform's (which apps the team has on); Appearance and
// Sign-in are G3ID's settings; Members and Kiosk Devices are G3ID's people and kiosks (moved from
// ID, which only signs people in now); Integrations connects the team's chat, Slack or Discord
// (G3ID's), and shows what else
// each app is connected to; Notifications says where the platform's notifications go; and Log is
// the team's log of apps and settings changed.
// A setting for one app stays on that app's own pages.

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
    { path: "/admin/members", element: admin(<MembersPage />) },
    { path: "/admin/members/:id", element: admin(<MemberPage />) },
    { path: "/admin/kiosks", element: admin(<KiosksPage />) },
    { path: "/admin/appearance", element: admin(<AppearancePage />) },
    { path: "/admin/sign-in", element: admin(<SignInPage />) },
    { path: "/admin/slack", element: <SlackMoved /> },
    { path: "/admin/integrations", element: admin(<IntegrationsPage />) },
    { path: "/admin/notifications", element: admin(<NotificationsPage />) },
    { path: "/admin/operator-access", element: admin(<OperatorAccessPage />) },
    { path: "/admin/log", element: admin(<LogPage />) },
  ],
  navItems: [
    { label: "Manage Apps", to: "/admin", order: 10, requiresAdmin: true, group: "Admin" },
    { label: "Members", to: "/admin/members", order: 11, requiresAdmin: true, group: "Admin" },
    {
      label: "Appearance",
      to: "/admin/appearance",
      order: 12,
      requiresAdmin: true,
      group: "Admin",
    },
    { label: "Sign-in", to: "/admin/sign-in", order: 13, requiresAdmin: true, group: "Admin" },
    {
      label: "Kiosk Devices",
      to: "/admin/kiosks",
      order: 14,
      requiresAdmin: true,
      group: "Admin",
    },
    {
      label: "Integrations",
      to: "/admin/integrations",
      order: 15,
      requiresAdmin: true,
      group: "Admin",
    },
    {
      label: "Notifications",
      to: "/admin/notifications",
      order: 16,
      requiresAdmin: true,
      group: "Admin",
    },
    {
      label: "Operator Access",
      to: "/admin/operator-access",
      order: 17,
      requiresAdmin: true,
      group: "Admin",
    },
    { label: "Log", to: "/admin/log", order: 18, requiresAdmin: true, group: "Admin" },
  ],
};
