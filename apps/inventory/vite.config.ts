import { siteConfig } from "@g3/site-config/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    siteConfig({
      app: "inventory",
      productionEnv: { VITE_API_BASE_URL: "/api" },
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5186,
    strictPort: true,
    allowedHosts: [".grayjn.com"],
    proxy: {
      "/api": {
        target: "http://localhost:8797",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
