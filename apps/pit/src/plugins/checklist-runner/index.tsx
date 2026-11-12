// SPDX-License-Identifier: AGPL-3.0-only
import type { Plugin } from "../../shared/plugin-types";
import { ChecklistRunnerListPage } from "./checklist-runner-list-page";
import { ChecklistRunnerPage } from "./checklist-runner-page";

export const checklistRunnerPlugin: Plugin = {
  name: "checklist-runner",
  routes: [
    { path: "/checklists", element: <ChecklistRunnerListPage /> },
    { path: "/checklists/:id", element: <ChecklistRunnerPage /> },
  ],
  navItems: [{ label: "Checklists", to: "/checklists", order: 1 }],
};
