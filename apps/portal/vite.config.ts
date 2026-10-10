import { siteConfig } from "@g3/site-config/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [siteConfig({ app: "portal" }), react(), tailwindcss()],
  server: {
    port: 5178,
    strictPort: true,
  },
});
