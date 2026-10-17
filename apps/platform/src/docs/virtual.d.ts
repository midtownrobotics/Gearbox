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
