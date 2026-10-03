import { apiUrl } from "@g3/site-config";
import { siteConfig } from "@g3/site-config/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    siteConfig({ app: "portal", productionEnv: { VITE_G3ID_API_URL: apiUrl("id") } }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5178,
    strictPort: true,
  },
});
