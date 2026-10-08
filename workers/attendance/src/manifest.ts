import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
export const manifest = defineManifest({
  slug: "attendance",
  name: "Attendance",
  summary: "Shop sign-in and sign-out at a kiosk, with hours and a leaderboard.",
  roles: ["admin", "member", "kiosk"],
  integrations: [],
  availability: "every team",
  version: packageJson.version,
  hooks: { seed: false, delete: true },
});
