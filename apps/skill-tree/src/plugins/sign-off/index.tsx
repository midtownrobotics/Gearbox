import type { Plugin } from "../../shared/plugin-types";
import { SignOffPage } from "./sign-off-page";

export const signOffPlugin: Plugin = {
  name: "sign-off",
  routes: [{ path: "/sign-off", element: <SignOffPage /> }],
  navItems: [{ label: "Sign Off", to: "/sign-off", order: 30, mentorOnly: true }],
};
