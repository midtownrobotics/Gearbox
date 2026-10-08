import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
// Only the site's team: Scouting's data isn't kept per team yet (roadmap Phase 3).
export const manifest = defineManifest({
  slug: "scouting",
  name: "Scouting",
  summary: "Match and pit scouting, picklists and match predictions.",
  roles: ["admin", "mentor", "member"],
  integrations: ["slack", "the blue alliance"],
  availability: "site team",
  version: packageJson.version,
  hooks: { seed: false, delete: false },
});
