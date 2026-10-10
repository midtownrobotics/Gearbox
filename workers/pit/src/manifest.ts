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
  hooks: { seed: false, delete: true, export: true },
  settings: [
    {
      key: "eventKey",
      label: "The Blue Alliance event key",
      type: "text",
      default: null,
      help: "Like 2026nyro",
      editedBy: "admin",
      page: "/admin",
    },
    {
      key: "nexusEventKey",
      label: "Nexus event key",
      type: "text",
      default: null,
      editedBy: "admin",
      page: "/admin",
    },
    {
      key: "iframeUrl",
      label: "Stream link",
      type: "url",
      default: null,
      editedBy: "admin",
      page: "/admin",
    },
  ],
  settingsForm: true,
  plugins: [],
});
