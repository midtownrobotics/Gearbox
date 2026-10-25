// Built from every app's docs folder by ../../docs-plugin.ts.
declare module "virtual:gearbox-docs" {
  export type DocsHeading = { id: string; text: string; depth: number };
  export type DocsPage = {
    section: string;
    slug: string;
    title: string;
    summary: string;
    order: number;
    html: string;
    text: string;
    headings: DocsHeading[];
    source: string;
    /** The app page the doc is about (tutorial mode), or null. */
    appPath: string | null;
    /** Who can open the app page it's about (tutorial mode skips it for others). */
    access: "everyone" | "mentor" | "admin";
    /** The switchable part of an app it's about (tutorial mode skips it while that's off). */
    feature: string | null;
  };
  export type DocsSection = {
    id: string;
    title: string;
    summary: string;
    order: number;
    app: string | null;
  };
  export const sections: DocsSection[];
  export const pages: DocsPage[];
}
