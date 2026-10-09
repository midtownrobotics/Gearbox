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
  hooks: { seed: false, delete: true, export: true },
  settings: [
    {
      key: "capBytes",
      label: "Monthly data cap",
      type: "number",
      default: 0,
      help: "Bytes; 0 means no cap",
      editedBy: "admin",
      page: "/network",
    },
    {
      key: "cycleStartDay",
      label: "Billing day",
      type: "number",
      default: 1,
      help: "Day of the month the data cap starts again",
      editedBy: "admin",
      page: "/network",
    },
    {
      key: "enforce",
      label: "Blocking on",
      type: "boolean",
      default: false,
      editedBy: "admin",
      page: "/network/controls",
    },
    {
      key: "dnsHardening",
      label: "DNS hardening",
      type: "boolean",
      default: false,
      help: "Devices can only use the box's DNS",
      editedBy: "admin",
      page: "/network/controls",
    },
    {
      key: "boxKey",
      label: "Box key",
      type: "secret",
      default: null,
      help: "Made on the Edge Box page; shown once",
      editedBy: "admin",
      page: "/box",
    },
  ],
  plugins: [],
});
