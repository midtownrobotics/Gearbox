import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
export const manifest = defineManifest({
  slug: "inventory",
  name: "Inventory",
  summary: "What the team owns, where it's kept and what's on a robot.",
  roles: ["admin", "mentor", "member", "kiosk"],
  permissions: [
    {
      key: "manage",
      label: "Manage Inventory",
      description: "Change fields, locations and inventory settings.",
      roles: [],
      includes: ["items"],
    },
    {
      key: "items",
      label: "Manage items",
      description: "Delete, merge and split inventory entries.",
      roles: ["mentor"],
    },
  ],
  integrations: [],
  availability: "every team",
  version: packageJson.version,
  hooks: { seed: false, delete: true, export: true },
  // Fields, locations, robots and subsystems are the team's content (Settings, or a setup file),
  // not settings with defaults.
  settings: [],
  plugins: [],
});
