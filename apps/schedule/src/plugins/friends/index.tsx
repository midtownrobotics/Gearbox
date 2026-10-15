import type { Plugin } from "../../shared/plugin-types";
import { FriendsPage } from "./friends-page";

export const friendsPlugin: Plugin = {
  name: "friends",
  routes: [{ path: "/friends", element: <FriendsPage /> }],
  navItems: [{ label: "Friends", to: "/friends", order: 15 }],
};
