import { siteConfig } from "@g3/site-config/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [siteConfig(), react(), tailwindcss()],
  server: {
    port: 5185,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8795",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
