// SPDX-License-Identifier: AGPL-3.0-only
import type { Plugin } from "../../shared/plugin-types";
import { ClientDetailPage } from "./client-detail-page";
import { ClientsPage } from "./clients-page";
import { ControlsPage } from "./controls-page";
import { OverviewPage } from "./overview-page";
import { SiteDetailPage } from "./site-detail-page";
import { SitesPage } from "./sites-page";

export const networkPlugin: Plugin = {
  name: "network",
  routes: [
    { path: "/network", element: <OverviewPage /> },
    { path: "/network/clients", element: <ClientsPage /> },
    { path: "/network/clients/:mac", element: <ClientDetailPage /> },
    { path: "/network/sites", element: <SitesPage /> },
    { path: "/network/sites/:site", element: <SiteDetailPage /> },
    { path: "/network/controls", element: <ControlsPage /> },
  ],
  navItems: [
    { label: "Overview", to: "/network", order: 10, group: "Network" },
    { label: "Clients", to: "/network/clients", order: 11, group: "Network" },
    { label: "Sites", to: "/network/sites", order: 12, group: "Network", adminOnly: true },
    { label: "Controls", to: "/network/controls", order: 13, group: "Network", adminOnly: true },
  ],
};
