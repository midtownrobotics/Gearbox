// SPDX-License-Identifier: AGPL-3.0-only
import { PartDetailPage } from "./part-detail-page";

export const partDetailPlugin = {
  routes: [
    {
      path: "/part",
      element: <PartDetailPage />,
    },
  ],
  navItems: [],
};
