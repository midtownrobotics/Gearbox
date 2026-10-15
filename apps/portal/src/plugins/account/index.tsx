import type { Plugin } from "../../shared/plugin-types";
import { AccountPage } from "./account-page";

// Each member's own account, on the team's home (it was ID's dashboard): their sign-ins, kiosk
// PIN and signing out. The bar's "Hello, name" opens it.
export const accountPlugin: Plugin = {
  name: "account",
  routes: [{ path: "/account", element: <AccountPage /> }],
  navItems: [{ label: "Account", to: "/account", order: 5, requiresAuth: true }],
};
