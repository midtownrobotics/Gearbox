import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
// Always on: every team has it, so it's never in the app library.
export const manifest = defineManifest({
  slug: "id",
  name: "ID",
  summary: "Sign-in for the team's members: accounts, roles, kiosk PINs and the team's Slack.",
  roles: ["admin", "mentor", "member", "kiosk"],
  integrations: ["slack"],
  availability: "every team",
  alwaysOn: true,
  version: packageJson.version,
  hooks: { seed: false, delete: false },
});
