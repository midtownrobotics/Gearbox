import type { Plugin } from "../../shared/plugin-types";
import { CalendarPage } from "./calendar-page";

export const calendarPlugin: Plugin = {
  name: "calendar",
  routes: [{ path: "/calendar", element: <CalendarPage /> }],
  navItems: [{ label: "Calendar", to: "/calendar", order: 10 }],
};
