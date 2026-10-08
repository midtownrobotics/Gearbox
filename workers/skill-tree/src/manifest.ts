import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
export const manifest = defineManifest({
  slug: "skillTree",
  name: "Skill Tree",
  summary: "The skills each student has learned, signed off by mentors.",
  roles: ["admin", "mentor", "member", "kiosk"],
  integrations: [],
  availability: "every team",
  version: packageJson.version,
  hooks: { seed: true, delete: true },
});
