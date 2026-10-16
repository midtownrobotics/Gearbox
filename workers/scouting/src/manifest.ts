import { defineManifest } from "@g3/auth";
import packageJson from "../package.json";

// What this app tells the platform about itself (roadmap 4.1; the type is in @g3/auth).
export const manifest = defineManifest({
  slug: "scouting",
  name: "Scouting",
  summary: "Match and pit scouting, picklists and match predictions.",
  roles: ["admin", "mentor", "member"],
  integrations: ["slack or discord", "the blue alliance"],
  availability: "every team",
  version: packageJson.version,
  hooks: { seed: true, delete: true, export: true, demo: true },
  settings: [
    {
      key: "pointsLabel",
      label: "Points name",
      type: "text",
      default: "Scout Points",
      editedBy: "admin",
      page: "/admin",
    },
    {
      key: "submissionWindowSeconds",
      label: "Auto-advance delay",
      type: "number",
      default: 120,
      min: 0,
      max: 1800,
      help: "seconds",
      editedBy: "admin",
      page: "/admin",
    },
  ],
  // Engagement (engagement.ts): each switched on and off on Scouting's Admin page.
  plugins: [
    {
      key: "points",
      name: "Scout points",
      summary: "Points for scouting matches.",
      default: false,
    },
    {
      key: "predictions",
      name: "Match predictions",
      summary: "Spend points predicting match results.",
      default: true,
      requires: ["points"],
    },
    {
      key: "combinations",
      name: "Combined picks",
      summary: "Predictions on several matches at once.",
      default: false,
      requires: ["predictions"],
    },
    {
      key: "standings",
      name: "Team standings",
      summary: "A leaderboard of scouts' points.",
      default: false,
      requires: ["points"],
    },
  ],
});
