import { appUrl } from "@g3/site-config";
import { siteConfig } from "@g3/site-config/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    siteConfig({
      app: "attendance",
      productionEnv: { VITE_API_URL: "/api", VITE_G3ID_WEB: appUrl("id") },
    }),
    react(),
  ],
  server: {
    port: 5181,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8791",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
