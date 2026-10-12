import type { Plugin } from "../../shared/plugin-types";
import { OnshapePage } from "./onshape-page";
import { ReleasePage } from "./release-page";

export const onshapePlugin: Plugin = {
  name: "onshape",
  routes: [
    { path: "/onshape", element: <OnshapePage /> },
    { path: "/onshape/releases/:id", element: <ReleasePage /> },
  ],
  navItems: [{ label: "Onshape", to: "/onshape", order: 2 }],
};
