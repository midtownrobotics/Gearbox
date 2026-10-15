import type { Plugin } from "../../shared/plugin-types";
import { LeaderboardPage } from "./leaderboard-page";

export const leaderboardPlugin: Plugin = {
  name: "leaderboard",
  routes: [{ path: "/leaderboard", element: <LeaderboardPage /> }],
  navItems: [{ label: "Leaderboard", to: "/leaderboard", order: 10 }],
};
