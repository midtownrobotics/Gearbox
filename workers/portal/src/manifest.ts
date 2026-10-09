import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
// Always on: every team has it, so it's never in the app library.
export const manifest = defineManifest({
  slug: "portal",
  name: "Home",
  summary: "The team's home: its apps and links, and the admin pages.",
  roles: ["admin", "member"],
  integrations: [],
  availability: "every team",
  alwaysOn: true,
  version: packageJson.version,
  hooks: { seed: false, delete: false, export: false },
  settings: [],
  plugins: [],
});
