import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
export const manifest = defineManifest({
  slug: "schedule",
  name: "Schedule",
  summary: "The team's meetings, events and deadlines.",
  roles: ["admin", "mentor", "member", "kiosk"],
  integrations: [],
  availability: "every team",
  version: packageJson.version,
  hooks: { seed: false, delete: true, export: true },
  settings: [],
  plugins: [],
});
