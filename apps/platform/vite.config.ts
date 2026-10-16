import { platformUrlVia } from "@g3/site-config";
import { siteConfig } from "@g3/site-config/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

/**
 * Link previews (Chief Delphi, Discord, Slack): crawlers don't run the page, so the cards come
 * from index.html. Their addresses are the platform's own, from site-config.
 */
function linkPreviews(): Plugin {
  const url = platformUrlVia(undefined);
  const title = "Gearbox: free apps to run your FRC team";
  const description =
    "Free, open source apps to run your FRC team: orders, shop tracking, pit checklists and scouting, with one sign-in through your team's Slack.";
  const tags = [
    ["og:type", "website"],
    ["og:site_name", "Gearbox"],
    ["og:title", title],
    ["og:description", description],
    ["og:url", `${url}/`],
    ["og:image", `${url}/icon-512.png`],
  ]
    .map(([property, content]) => `    <meta property="${property}" content="${content}" />`)
    .concat([
      '    <meta name="twitter:card" content="summary" />',
      `    <meta name="twitter:title" content="${title}" />`,
      `    <meta name="twitter:description" content="${description}" />`,
    ])
    .join("\n");
  return {
    name: "gearbox-link-previews",
    transformIndexHtml: (html) => html.replace("</head>", `${tags}\n  </head>`),
  };
}

export default defineConfig({
  plugins: [siteConfig(), linkPreviews(), react(), tailwindcss()],
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
