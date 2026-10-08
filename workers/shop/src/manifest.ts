import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
export const manifest = defineManifest({
  slug: "shop",
  name: "Shop",
  summary: "Parts through manufacturing: processes, part files, drawings and Onshape releases.",
  roles: ["admin", "mentor", "member", "kiosk"],
  integrations: ["slack", "onshape", "edge box"],
  availability: "every team",
  version: packageJson.version,
  hooks: { seed: false, delete: true },
});
