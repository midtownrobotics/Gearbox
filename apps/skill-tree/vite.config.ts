import { appUrl } from "@g3/site-config";
import { siteConfig } from "@g3/site-config/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    siteConfig({
      app: "skillTree",
      productionEnv: { VITE_API_BASE_URL: "/api", VITE_G3ID_URL: appUrl("id") },
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5180,
    strictPort: true,
    allowedHosts: [".grayjn.com"],
    proxy: {
      "/api": {
        target: "http://localhost:8790",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
