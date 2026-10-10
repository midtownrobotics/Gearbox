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
  hooks: { seed: true, delete: true, export: true },
  settings: [
    {
      key: "currency",
      label: "Currency",
      type: "text",
      default: "USD",
      help: "A 3-letter code (USD, CAD, EUR) for budgets and prices",
      editedBy: "mentor",
      page: "/settings",
    },
    {
      key: "fiscalYearStart",
      label: "Fiscal year starts",
      type: "month",
      default: 7,
      help: "Budgets run from this month",
      editedBy: "mentor",
      page: "/settings",
    },
    {
      key: "namingTemplate",
      label: "Request names",
      type: "text",
      default: "{vendor} {sku} – {title}",
      help: "Must include {title}",
      editedBy: "mentor",
      page: "/settings",
    },
    {
      key: "inventoryRequired",
      label: "Receiving needs an Inventory place",
      type: "boolean",
      default: false,
      editedBy: "mentor",
      page: "/settings",
    },
  ],
  plugins: [],
});
