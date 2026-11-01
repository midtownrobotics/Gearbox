// SPDX-License-Identifier: AGPL-3.0-only
import type { Plugin } from "../../shared/plugin-types";
import { OverviewPage } from "./overview-page";

export const overviewPlugin: Plugin = {
  name: "overview",
  routes: [{ path: "/overview", element: <OverviewPage /> }],
  navItems: [{ label: "Overview", to: "/overview", order: 10 }],
};
