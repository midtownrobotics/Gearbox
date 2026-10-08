import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
export const manifest = defineManifest({
  slug: "orders",
  name: "Orders",
  summary: "Parts requests, approvals, vendor carts, budgets and deliveries.",
  roles: ["admin", "mentor", "member", "kiosk"],
  integrations: ["slack", "edge box", "share-a-cart"],
  availability: "every team",
  version: packageJson.version,
  hooks: { seed: true, delete: true },
});
