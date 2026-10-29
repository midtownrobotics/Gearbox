import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_FEATURES, docsFrontMatter, pagePaths } from "@g3/site-config/help";
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
//   pages: /admin /vendors   (the app's pages it's about, as its route paths; not index.md)
//   access: mentor           (who can open those pages: everyone (the default), mentor, admin)
//   feature: scouting-points (a part of the app a team can switch off; DOCS_FEATURES)
//   preview: Not ready yet… (index.md only: a red warning on every page of the section)
//   ---
//
// Every page in an app's folder but index.md names its app's pages: the bar's "Need help?" on one
// of them opens that doc, and on any other page the app's index.md (@g3/site-config/help). Each
// path must be one of the app's routes (a quoted "/path" in `apps/<app>/src`) and in one doc only,
// or the build fails. **When a page's address changes, change it in its doc's `pages` too.**
//
// Links between pages are docs paths: `/orders/setup`, `/orders/setup#budgets`, or within the
// section `setup` or `setup.md`. A link to a page that doesn't exist fails the build, and so does
// a link to a page later in reading order: the docs read from basics to advanced, so a page only
// links back to pages the reader has already met (name a later page in words, without a link). A link
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
  /**
   * The app page the doc is about, which a tutorial panel opens beside it (`appPathOf`), or null:
   * a doc that isn't about one of an app's pages (Getting started, Reference).
   */
  appPath: string | null;
  /**
   * Who can open the app page it's about: a tutorial panel's previous and next links skip it for
   * anyone else. "mentor" means mentors and admins.
   */
  access: DocsAccess;
  /** The switchable part of the app it's about (tutorial mode skips it while that's off). */
  feature: string | null;
};

export type DocsAccess = "everyone" | "mentor" | "admin";
const ACCESS: DocsAccess[] = ["everyone", "mentor", "admin"];

export type DocsSection = {
  id: string;
  title: string;
  summary: string;
  order: number;
  /** The app the section is about (its key in site.apps), when it's an app's. */
  app: string | null;
  /** A warning shown on every page of the section (an app that isn't ready yet), or null. */
  preview: string | null;
};

/** The section id for an app's folder. */
const sectionOf = (folder: string) => (folder === "platform" ? "start" : folder);

/** An app's folder → its key in site.apps (skill-tree → skillTree). */
const appKey = (folder: string) => folder.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

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

type Draft = Omit<DocsPage, "html" | "text" | "headings" | "appPath"> & {
  body: string;
  file: string;
  /** The app's folder. */
  folder: string;
  /** The app's pages it's about (`pages:`). */
  appPages: string[];
};

/** A file's `feature:`, or a problem with it. */
function featureOf(value: string | undefined, file: string): string | null {
  if (!value) return null;
  if (!(DOCS_FEATURES as readonly string[]).includes(value)) {
    throw new Error(`${file}: feature is "${value}"; use one of ${DOCS_FEATURES.join(", ")}`);
  }
  return value;
}

/** A file's `access:`, or a problem with it. */
function accessOf(value: string | undefined, file: string): DocsAccess {
  const access = (value ?? "everyone") as DocsAccess;
  if (!ACCESS.includes(access)) {
    throw new Error(`${file}: access is "${value}"; use one of ${ACCESS.join(", ")}`);
  }
  return access;
}

/** Reads every docs folder. */
function readDrafts(): { drafts: Draft[]; sections: DocsSection[]; files: string[] } {
  const drafts: Draft[] = [];
  const sections: DocsSection[] = [];
  const files: string[] = [];
  for (const folder of readdirSync(appsDir).sort()) {
    const docs = join(appsDir, folder, "docs");
    if (!existsSync(docs)) continue;
    // The platform's folder is Getting started; each folder inside it is a section of its own
    // (docs/reference: the checklist and troubleshooting, at the end).
    const dirs: [dir: string, section: string][] = [[docs, sectionOf(folder)]];
    if (folder === "platform") {
      for (const entry of readdirSync(docs, { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push([join(docs, entry.name), entry.name]);
      }
    }
    for (const [dir, section] of dirs) {
      for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
        const file = join(dir, name);
        files.push(file);
        const source = relative(repoRoot, file);
        const { fields, body } = docsFrontMatter(readFileSync(file, "utf8"), source);
        const slug = name === "index.md" ? "" : name.slice(0, -3);
        const order = Number(fields.order ?? 100);
        const page = {
          section,
          slug,
          title: fields.title,
          summary: fields.summary ?? "",
          order,
          access: accessOf(fields.access, source),
          feature: featureOf(fields.feature, source),
        };
        drafts.push({
          ...page,
          body,
          file: source,
          source,
          folder,
          appPages: pagePaths(fields.pages),
        });
        if (slug === "") {
          sections.push({
            id: section,
            title: page.title,
            summary: page.summary,
            order,
            app: folder === "platform" ? null : appKey(folder),
            preview: fields.preview || null,
          });
        }
      }
      if (!sections.some((s) => s.id === section)) {
        throw new Error(`${relative(repoRoot, dir)} has no index.md (the section's front page)`);
      }
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

/** Every quoted string in an app's source that looks like a path: its routes are among them. */
function routeStrings(folder: string): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        for (const m of readFileSync(path, "utf8").matchAll(/["'`](\/[\w\-/:]*)["'`]/g)) {
          found.add(m[1]);
        }
      }
    }
  };
  const src = join(appsDir, folder, "src");
  if (existsSync(src)) walk(src);
  return found;
}

/** Problems with the app pages each doc names (`pages:`), for "Need help?". */
function pageProblems(drafts: Draft[]): string[] {
  const problems: string[] = [];
  const routes = new Map<string, Set<string>>();
  const named = new Map<string, string>();
  for (const draft of drafts) {
    if (draft.folder === "platform") continue;
    if (draft.slug === "") {
      if (draft.appPages.length > 0) {
        problems.push(`${draft.file}: index.md is the app's front page; list pages in other docs`);
      }
      continue;
    }
    if (draft.appPages.length === 0) {
      problems.push(`${draft.file}: has no \`pages:\` (the app's pages it's about)`);
    }
    if (!routes.has(draft.folder)) routes.set(draft.folder, routeStrings(draft.folder));
    for (const path of draft.appPages) {
      if (!routes.get(draft.folder)?.has(path)) {
        problems.push(
          `${draft.file}: pages names ${path}, which isn't a route in apps/${draft.folder}/src (did its address change?)`,
        );
      }
      const key = `${draft.folder} ${path}`;
      const other = named.get(key);
      if (other) problems.push(`${draft.file}: pages names ${path}, which ${other} names too`);
      else named.set(key, draft.file);
    }
  }
  return problems;
}

/**
 * Where an app's home ("/") really is: the page its `/` route redirects to (`<Route path="/"
 * element={<Navigate to="/requests" />} />`, or to a constant in the same file), else "/".
 */
function homeOf(folder: string): string {
  const src = join(appsDir, folder, "src");
  if (!existsSync(src)) return "/";
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) files.push(path);
    }
  };
  walk(src);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const route = text.match(
      /path[=:]\s*"\/"[\s,]*element[=:]\s*\{?\s*<Navigate\s+to=(?:"([^"]+)"|\{(\w+)\})/,
    );
    if (!route) continue;
    if (route[1]) return route[1];
    const constant = text.match(new RegExp(`const ${route[2]}\\s*=\\s*"([^"]+)"`));
    if (constant) return constant[1];
  }
  return "/";
}

/**
 * The app page a doc is about, for tutorial mode: its first page with no `:name` part, or for an
 * app's front page its home (where "/" redirects to, `homeOf`), even when another doc is about
 * that page (the panel keeps the front page while the app follows). Null for the platform's docs,
 * or a doc whose pages all need an id (an entry's page).
 */
function appPathOf(draft: Draft, homes: Map<string, string>): string | null {
  if (draft.folder === "platform") return null;
  if (draft.slug === "") {
    if (!homes.has(draft.folder)) homes.set(draft.folder, homeOf(draft.folder));
    return homes.get(draft.folder) ?? "/";
  }
  return draft.appPages.find((path) => !path.includes(":")) ?? null;
}

/** Every page as HTML, with problems (broken links, unknown pages) listed rather than thrown. */
export function buildDocs() {
  const { drafts, sections, files } = readDrafts();
  const pathOf = (d: { section: string; slug: string }) =>
    `/${d.section}${d.slug ? `/${d.slug}` : ""}`;
  const known = new Set(drafts.map(pathOf));
  // Where each page comes in reading order (src/docs/docs-data.ts: section by section), so a link
  // only ever goes back to a page the reader has met.
  const place = new Map(
    sections.flatMap((s) => drafts.filter((d) => d.section === s.id)).map((d, i) => [pathOf(d), i]),
  );
  const problems: string[] = pageProblems(drafts);
  const homes = new Map<string, string>();
  /** Links to a heading on another page, checked once every page is built. */
  const anchors: { file: string; href: string; target: string; hash: string }[] = [];

  const pages: DocsPage[] = drafts.map((draft) => {
    const { body, file, folder: _, appPages: __, ...page } = draft;
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
      if ((place.get(target) ?? 0) > (place.get(pathOf(page)) ?? 0)) {
        problems.push(
          `${file}: links ahead to ${href}; link only to pages before this one, which the reader has met`,
        );
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
    return { ...page, html, text: plain(html), headings, appPath: appPathOf(draft, homes) };
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
        const message = `Docs have problems:\n  ${problems.join("\n  ")}`;
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
