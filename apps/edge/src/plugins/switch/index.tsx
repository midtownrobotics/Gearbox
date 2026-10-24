import type { Plugin } from "../../shared/plugin-types";
import { DoorSoundsPage } from "./sounds-page";
import { SoundSubmissionsPage } from "./submissions-page";

export const switchPlugin: Plugin = {
  name: "switch",
  routes: [
    { path: "/door-sounds", element: <DoorSoundsPage /> },
    { path: "/sound-requests", element: <SoundSubmissionsPage /> },
  ],
  navItems: [
    { label: "Suggest a sound", to: "/sound-requests", order: 71, group: "Edge Box" },
    {
      label: "Door Sounds",
      to: "/door-sounds",
      order: 70,
      group: "Edge Box",
      mentorOnly: true,
    },
  ],
};
