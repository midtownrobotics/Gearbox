import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
export const manifest = defineManifest({
  slug: "edge",
  name: "Edge",
  summary:
    "The team's own network box: data use, blocking, printing, a shop drive and door sounds.",
  roles: ["admin", "member"],
  integrations: ["edge box"],
  availability: "every team",
  version: packageJson.version,
  hooks: { seed: false, delete: true },
});
