import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The status page. `start` builds it into dist/web, which the server serves; `watch` runs Vite
// inside the server instead (src/index.ts).
export default defineConfig({
  root: fileURLToPath(new URL("./web", import.meta.url)),
  plugins: [react(), tailwindcss()],
  // @g3/ui loads the team's appearance from G3ID's /team/ui; here the server answers it, for the
  // team the downloader is paired with (src/gearbox.ts).
  define: { "import.meta.env.VITE_G3ID_API_URL": JSON.stringify("/api/gearbox") },
  build: {
    outDir: fileURLToPath(new URL("./dist/web", import.meta.url)),
    emptyOutDir: true,
  },
});
