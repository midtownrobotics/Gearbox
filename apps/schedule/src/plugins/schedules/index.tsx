import type { Plugin } from "../../shared/plugin-types";
import { EditPage } from "./edit-page";
import { ListPage } from "./list-page";
import { SchedulePage } from "./schedule-page";

export const schedulesPlugin: Plugin = {
  name: "schedules",
  routes: [
    { path: "/schedules", element: <ListPage /> },
    { path: "/schedules/:id", element: <SchedulePage /> },
    { path: "/schedules/:id/edit", element: <EditPage /> },
  ],
  navItems: [{ label: "Schedules", to: "/schedules", order: 10 }],
};
