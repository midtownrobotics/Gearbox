import { siteConfig } from "@g3/site-config/vite";
import { defineConfig } from "vite";

// The skill-tree app is intentionally buildless vanilla JS (no framework, no
// TypeScript). Vite just serves the ES modules in dev and bundles them for prod.
// Backend URLs come from @g3/site-config (localhost ones in dev).
export default defineConfig({
  plugins: [siteConfig({ app: "skillTree" })],
  server: {
    port: 5180,
    allowedHosts: [".grayjn.com"],
  },
});
