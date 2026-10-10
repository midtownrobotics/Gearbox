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
  hooks: { seed: false, delete: true, export: true },
  // Edited on G3ID's Attendance admin page, which stays on G3ID with members and kiosks.
  settings: [
    {
      key: "schoolYearStart",
      label: "School year starts",
      type: "day of year",
      default: "08-01",
      help: "Month and day; hours count from here",
      editedBy: "admin",
      page: "id:/admin/attendance",
    },
    {
      key: "autoSignOutHours",
      label: "Auto sign-out",
      type: "number",
      default: 12,
      min: 1,
      max: 24,
      help: "Hours; a session open longer is closed and doesn't count",
      editedBy: "admin",
      page: "id:/admin/attendance",
    },
  ],
  settingsForm: true,
  plugins: [],
});
