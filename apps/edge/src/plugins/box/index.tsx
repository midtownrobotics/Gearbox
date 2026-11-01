// SPDX-License-Identifier: AGPL-3.0-only
import type { Plugin } from "../../shared/plugin-types";
import { StatusPage } from "./status-page";

export const boxPlugin: Plugin = {
  name: "box",
  routes: [{ path: "/box", element: <StatusPage /> }],
  navItems: [{ label: "Edge Box", to: "/box", order: 100 }],
};
