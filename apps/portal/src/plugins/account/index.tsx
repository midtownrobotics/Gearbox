import type { Plugin } from "../../shared/plugin-types";
import { RequiresApp } from "../../shared/requires-app";
import { DashboardPage } from "./dashboard-page";
import { LeaderboardPage } from "./leaderboard-page";

export const accountPlugin: Plugin = {
  name: "account",
  routes: [
    { path: "/account", element: <DashboardPage /> },
    { path: "/dashboard", element: <DashboardPage /> },
    {
      path: "/leaderboard",
      element: (
        <RequiresApp app="attendance" name="Attendance">
          <LeaderboardPage />
        </RequiresApp>
      ),
    },
  ],
  navItems: [
    { label: "Account", to: "/account", order: 1, requiresAuth: true },
    {
      label: "Leaderboard",
      to: "/leaderboard",
      order: 2,
      requiresAuth: true,
      requiresApp: "attendance",
    },
  ],
};
