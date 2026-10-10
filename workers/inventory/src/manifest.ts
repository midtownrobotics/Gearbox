import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
export const manifest = defineManifest({
  slug: "inventory",
  name: "Inventory",
  summary: "What the team owns, where it's kept and what's on a robot.",
  roles: ["admin", "mentor", "member", "kiosk"],
  integrations: [],
  availability: "every team",
  version: packageJson.version,
  hooks: { seed: false, delete: true, export: true },
  // Fields, locations, robots and subsystems are the team's content (Settings, or a setup file),
  // not settings with defaults.
  settings: [],
  plugins: [],
});
