import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
export const manifest = defineManifest({
  slug: "pit",
  name: "Pit",
  summary: "The pit at an event: checklists, match schedule and the team's stream.",
  roles: ["admin", "member", "kiosk"],
  integrations: ["the blue alliance"],
  availability: "every team",
  version: packageJson.version,
  hooks: { seed: false, delete: true },
});
