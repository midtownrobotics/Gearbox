// SPDX-License-Identifier: AGPL-3.0-only
import type { Plugin } from "../../shared/plugin-types";
import { MyAttendancePage } from "./my-attendance-page";

export const myAttendancePlugin: Plugin = {
  name: "me",
  routes: [{ path: "/me", element: <MyAttendancePage /> }],
  navItems: [{ label: "My Attendance", to: "/me", order: 15 }],
};
