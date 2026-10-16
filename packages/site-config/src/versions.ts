// Versions, filled in at build time by siteConfig() (vite.ts): the app's own version (its
// package.json, shared with its worker) and the platform release it's part of (the root
// package.json). "dev" when built without the plugin.

declare const __G3_APP_VERSION__: string | undefined;
declare const __G3_PLATFORM_VERSION__: string | undefined;

export const appVersion = typeof __G3_APP_VERSION__ === "string" ? __G3_APP_VERSION__ : "dev";
export const platformVersion =
  typeof __G3_PLATFORM_VERSION__ === "string" ? __G3_PLATFORM_VERSION__ : "dev";

/** "Orders 1.4.0 · platform 2026.10.0", for an app's navbar. */
export const versionLabel = (app: string) => `${app} ${appVersion} · platform ${platformVersion}`;
