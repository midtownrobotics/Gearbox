import { siteConfig } from "@g3/site-config/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// AdvantageScope Lite is static files in public/scope (advantagescope/build.mjs). In dev, /scope/
// is its index.html, as in production, not Pit's page.
const advantageScopeIndex: Plugin = {
  name: "advantagescope-index",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === "/scope" || req.url?.startsWith("/scope/?") || req.url === "/scope/") {
        req.url = `/scope/index.html${req.url.slice(req.url.indexOf("?") >= 0 ? req.url.indexOf("?") : req.url.length)}`;
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [
    advantageScopeIndex,
    siteConfig({
      app: "pit",
      productionEnv: { VITE_API_BASE_URL: "/api" },
    }),

    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "favicon.svg", "apple-touch-icon.png"],
      manifest: {
        // One build serves every team, so the installed app is just "Pit".
        name: "Pit",
        short_name: "Pit",
        description: "Pit management and operations",
        theme_color: "#111827",
        background_color: "#030712",
        display: "standalone",
        scope: "/",
        start_url: "/",
        lang: "en",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // AdvantageScope (/scope/) is its own page, too large to download for everyone who opens
        // Pit: it's kept for offline as it's used instead, with its models and logs.
        globIgnores: ["scope/**"],
        importScripts: ["/scope-cache.js"],
        // A link to the API is a page load too: it must reach the worker, not get the app's
        // page like every other address does.
        navigateFallbackDenylist: [/^\/api\//, /^\/scope(\/|$)/],
        runtimeCaching: [
          {
            // Dev: same-origin /api/* via Vite proxy
            // Prod: the same, the API is at /api on the app's own address
            // Not AdvantageScope's match logs and models: large, and read fresh.
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/scope/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5175,
    strictPort: true,
    allowedHosts: [".grayjn.com"],
    proxy: {
      "/api": {
        target: "http://localhost:8789",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
