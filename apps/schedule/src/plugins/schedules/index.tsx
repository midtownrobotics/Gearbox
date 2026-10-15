import type { Plugin } from "../../shared/plugin-types";
import { EditPage } from "./edit-page";
import { ListPage } from "./list-page";
import { OpenClosest } from "./open-closest";
import { SchedulePage } from "./schedule-page";

export const schedulesPlugin: Plugin = {
  name: "schedules",
  routes: [
    // Schedules in the bar opens the closest schedule; every schedule is listed at /all.
    { path: "/schedules", element: <OpenClosest /> },
    { path: "/schedules/all", element: <ListPage /> },
    { path: "/schedules/:id", element: <SchedulePage /> },
    { path: "/schedules/:id/edit", element: <EditPage /> },
  ],
  navItems: [{ label: "Schedules", to: "/schedules", order: 10 }],
};
