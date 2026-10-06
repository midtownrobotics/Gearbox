import type { Plugin } from "../../shared/plugin-types";
import { HomePage } from "./home-page";

export const homePlugin: Plugin = {
  name: "home",
  routes: [{ path: "/", element: <HomePage /> }],
};
