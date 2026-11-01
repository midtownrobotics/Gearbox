// SPDX-License-Identifier: AGPL-3.0-only
import type { Plugin } from "../../shared/plugin-types";
import { AddPartPage } from "./add-part-page";
import { IngestPartsPage } from "./ingest-parts-page";
import { PartsPage } from "./parts-page";

export const partsPlugin: Plugin = {
  name: "parts",
  routes: [
    { path: "/parts", element: <PartsPage /> },
    { path: "/parts/new", element: <AddPartPage /> },
    { path: "/ingest", element: <IngestPartsPage /> },
  ],
  navItems: [
    { label: "Parts", to: "/parts", order: 1 },
    { label: "Ingest", to: "/ingest", order: 2 },
  ],
};
