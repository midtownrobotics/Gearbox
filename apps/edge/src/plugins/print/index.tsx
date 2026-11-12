// SPDX-License-Identifier: AGPL-3.0-only
import type { Plugin } from "../../shared/plugin-types";
import { PrintPage } from "./print-page";
import { PrintersPage } from "./printers-page";

export const printPlugin: Plugin = {
  name: "print",
  routes: [
    { path: "/print", element: <PrintPage /> },
    { path: "/print/printers", element: <PrintersPage /> },
  ],
  navItems: [
    { label: "Print", to: "/print", order: 50, group: "Print" },
    { label: "Printers", to: "/print/printers", order: 51, group: "Print" },
  ],
};
