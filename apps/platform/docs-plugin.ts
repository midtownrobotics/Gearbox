import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import type { Plugin } from "vite";

// The docs site (docs.<platform>): every app's `apps/<app>/docs/*.md`, built into the page as
// HTML by this plugin, so no Markdown parser ships to the browser. Each folder is one section of
// the docs, named by the app's folder (/orders, /skill-tree); its index.md is the section's front
// page and gives the section's title and place. The platform's own folder is "Getting started".
//
// Each file starts with front matter:
//   ---
//   title: Set up Orders
//   summary: One sentence, shown under the title and in the contents.
//   order: 1            (lower comes first; index.md's orders the sections)
//   ---
//
// Links between pages are docs paths: `/orders/setup`, `/orders/setup#budgets`, or within the
// section `setup` or `setup.md`. A link to a page that doesn't exist fails the build. A link
// `team:<app>/<path>` (`team:orders/admin`, `team:portal/admin/apps`) opens that page on the
// reader's own team when the browser knows it, and otherwise the platform's "find your team".

export const DOCS_MODULE = "virtual:gearbox-docs";
const RESOLVED = `\0${DOCS_MODULE}`;

const appsDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = resolve(appsDir, "..");

export type DocsHeading = { id: string; text: string; depth: number };

export type DocsPage = {
  /** The section's id: its folder's name, "start" for the platform's. */
  section: string;
  /** "" for the section's front page (index.md). */
  slug: string;
  title: string;
  summary: string;
  order: number;
  html: string;
  /** The page as plain text, for search. */
  text: string;
  headings: DocsHeading[];
  /** The file, from the repo root (for "Edit this page"). */
  source: string;
};

export type DocsSection = {
  id: string;
  title: string;
  summary: string;
  order: number;
  /** The app the section is about (its key in site.apps), when it's an app's. */
  app: string | null;
};

/** The section id for an app's folder. */
const sectionOf = (folder: string) => (folder === "platform" ? "start" : folder);

/** An app's folder → its key in site.apps (skill-tree → skillTree). */
const appKey = (folder: string) => folder.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

function frontMatter(source: string, file: string) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error(`${file}: starts without front matter (title, summary, order)`);
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^(\w+):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].trim();
  }
  if (!fields.title) throw new Error(`${file}: front matter has no title`);
  return { fields, body: source.slice(match[0].length) };
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

type Draft = Omit<DocsPage, "html" | "text" | "headings"> & { body: string; file: string };

/** Reads every docs folder. */
function readDrafts(): { drafts: Draft[]; sections: DocsSection[]; files: string[] } {
  const drafts: Draft[] = [];
  const sections: DocsSection[] = [];
  const files: string[] = [];
  for (const folder of readdirSync(appsDir).sort()) {
    const dir = join(appsDir, folder, "docs");
    if (!existsSync(dir)) continue;
    const section = sectionOf(folder);
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
      const file = join(dir, name);
      files.push(file);
      const source = relative(repoRoot, file);
      const { fields, body } = frontMatter(readFileSync(file, "utf8"), source);
      const slug = name === "index.md" ? "" : name.slice(0, -3);
      const order = Number(fields.order ?? 100);
      const page = { section, slug, title: fields.title, summary: fields.summary ?? "", order };
      drafts.push({ ...page, body, file: source, source });
      if (slug === "") {
        sections.push({
          id: section,
          title: page.title,
          summary: page.summary,
          order,
          app: folder === "platform" ? null : appKey(folder),
        });
      }
    }
    if (!sections.some((s) => s.id === section)) {
      throw new Error(`apps/${folder}/docs has no index.md (the section's front page)`);
    }
  }
  sections.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  drafts.sort(
    (a, b) =>
      (a.slug === "" ? -1 : 0) - (b.slug === "" ? -1 : 0) ||
      a.order - b.order ||
      a.title.localeCompare(b.title),
  );
  return { drafts, sections, files };
}

/** Every page as HTML, with problems (broken links) listed rather than thrown. */
export function buildDocs() {
  const { drafts, sections, files } = readDrafts();
  const known = new Set(drafts.map((d) => `/${d.section}${d.slug ? `/${d.slug}` : ""}`));
  const problems: string[] = [];
  /** Links to a heading on another page, checked once every page is built. */
  const anchors: { file: string; href: string; target: string; hash: string }[] = [];

  const pages: DocsPage[] = drafts.map(({ body, file, ...page }) => {
    const headings: DocsHeading[] = [];
    const ids = new Set<string>();

    /** A docs link's path, or null when it's broken. */
    const docsPath = (href: string) => {
      const [path, hash] = href.split("#");
      const target = path.startsWith("/")
        ? path.replace(/\/$/, "")
        : `/${page.section}${path === "index.md" || path === "" ? "" : `/${path.replace(/\.md$/, "")}`}`;
      if (!known.has(target)) {
        problems.push(`${file}: links to ${href}, which isn't a page`);
        return null;
      }
      if (hash) anchors.push({ file, href, target, hash });
      return hash ? `${target}#${hash}` : target;
    };

    const marked = new Marked({
      gfm: true,
      renderer: {
        heading({ tokens, depth }) {
          const inner = this.parser.parseInline(tokens);
          const text = plain(inner);
          let id = slugify(text) || "section";
          for (let n = 2; ids.has(id); n++) id = `${slugify(text)}-${n}`;
          ids.add(id);
          if (depth === 2 || depth === 3) headings.push({ id, text, depth });
          return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
        },
        link({ href, title, tokens }) {
          const inner = this.parser.parseInline(tokens);
          const titled = title ? ` title="${escapeHtml(title)}"` : "";
          if (/^(https?:|mailto:)/.test(href)) {
            return `<a href="${escapeHtml(href)}"${titled} rel="noopener">${inner}</a>`;
          }
          const team = href.match(/^team:([a-z-]+)(\/.*)?$/);
          if (team) {
            const app = appKey(team[1]);
            return `<a href="#" data-team-app="${app}" data-team-path="${escapeHtml(team[2] ?? "/")}"${titled}>${inner}</a>`;
          }
          if (href.startsWith("#")) return `<a href="${escapeHtml(href)}"${titled}>${inner}</a>`;
          const path = docsPath(href);
          return path
            ? `<a href="${escapeHtml(path)}" data-docs-link${titled}>${inner}</a>`
            : `<a${titled}>${inner}</a>`;
        },
      },
    });

    const html = marked.parse(body, { async: false });
    return { ...page, html, text: plain(html), headings };
  });

  for (const { file, href, target, hash } of anchors) {
    const page = pages.find((p) => `/${p.section}${p.slug ? `/${p.slug}` : ""}` === target);
    if (!page?.html.includes(`id="${hash}"`)) {
      problems.push(`${file}: links to ${href}, but that page has no heading #${hash}`);
    }
  }

  return { sections, pages, problems, files };
}

/** The Vite plugin: `import { sections, pages } from "virtual:gearbox-docs"`. */
export function gearboxDocs(): Plugin {
  let building = false;
  return {
    name: "gearbox-docs",
    configResolved(config) {
      building = config.command === "build";
    },
    resolveId: (id) => (id === DOCS_MODULE ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const { sections, pages, problems, files } = buildDocs();
      for (const file of files) this.addWatchFile(file);
      if (problems.length > 0) {
        const message = `Docs have broken links:\n  ${problems.join("\n  ")}`;
        if (building) this.error(message);
        this.warn(message);
      }
      return `export const sections = ${JSON.stringify(sections)};\nexport const pages = ${JSON.stringify(pages)};\n`;
    },
    handleHotUpdate({ file, server }) {
      if (!file.endsWith(".md") || !file.includes("/docs/")) return;
      const module = server.moduleGraph.getModuleById(RESOLVED);
      if (module) server.moduleGraph.invalidateModule(module);
      server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
