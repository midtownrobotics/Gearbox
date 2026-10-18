import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
export const manifest = defineManifest({
  slug: "schedule",
  name: "Schedule",
  summary: "Who does what at each event, 15 minutes at a time.",
  roles: ["admin", "mentor", "member", "kiosk"],
  integrations: ["slack or discord"],
  availability: "every team",
  version: packageJson.version,
  hooks: { seed: false, delete: true, export: true, demo: true },
  settings: [],
  plugins: [],
});
