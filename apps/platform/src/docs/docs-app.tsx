import { type AppName, platformUrl, site, teamAppUrl } from "@g3/site-config";
import { TextField, ThemeToggle, buttonClass, rememberedTeam } from "@g3/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import attendanceIcon from "../assets/app-icons/attendance.svg";
import edgeIcon from "../assets/app-icons/edge.svg";
import inventoryIcon from "../assets/app-icons/inventory.svg";
import ordersIcon from "../assets/app-icons/orders.svg";
import pitIcon from "../assets/app-icons/pit.svg";
import scheduleIcon from "../assets/app-icons/schedule.svg";
import scoutingIcon from "../assets/app-icons/scouting.svg";
import shopIcon from "../assets/app-icons/shop.svg";
import skillsIcon from "../assets/app-icons/skills.svg";
import {
  type DocsPage,
  type DocsSection,
  findPage,
  findSection,
  pagePath,
  pagesOf,
  readingOrder,
  searchDocs,
  sections,
} from "./docs-data";

// The docs site: docs.<platform> (base "") and /docs on the platform's own host (base "/docs").
// It belongs to no team, so it keeps the built-in colors, like the rest of the platform's pages.

const ICONS: Partial<Record<string, string>> = {
  portal: "/favicon.svg",
  shop: shopIcon,
  pit: pitIcon,
  orders: ordersIcon,
  edge: edgeIcon,
  scouting: scoutingIcon,
  skillTree: skillsIcon,
  attendance: attendanceIcon,
  inventory: inventoryIcon,
  schedule: scheduleIcon,
};

/** The reader's team (the one this browser last opened), or null. */
function useTeam(): number | null {
  const [team] = useState(() => rememberedTeam());
  return team;
}

/** An address on the reader's team, or the platform's "find your team" when it isn't known. */
function teamHref(team: number | null, app: string, path = "/") {
  if (!team) return `${platformUrl}/team`;
  const base = teamAppUrl(`frc${team}`, app as AppName);
  return path === "/" ? `${base}/` : `${base}${path}`;
}

export default function DocsApp({ base }: { base: string }) {
  return (
    <Routes>
      <Route
        index
        element={
          <Shell base={base}>
            <Home base={base} />
          </Shell>
        }
      />
      <Route path=":section/:slug?" element={<Article base={base} />} />
    </Routes>
  );
}

function Shell({
  base,
  current,
  children,
}: {
  base: string;
  current?: DocsPage;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const { pathname } = useLocation();
  const team = useTeam();
  // Following a link (a search result too) clears the search.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each new page
  useEffect(() => setQuery(""), [pathname]);

  const search = (
    <TextField
      type="search"
      variant="search"
      typeable
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search the docs"
      aria-label="Search the docs"
      className="w-full"
    />
  );

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="g3-nav is-flat">
        <div className="g3-nav-brand items-center gap-3">
          <a href={platformUrl} className="g3-nav-wordmark">
            <img className="g3-nav-icon" src="/favicon.svg" alt="" />
            GEARBOX
          </a>
          <Link
            to={base || "/"}
            className="border-l border-line pl-3 text-sm font-semibold text-secondary-700 hover:text-secondary-900"
          >
            Docs
          </Link>
        </div>
        <nav className="g3-nav-end">
          <a
            href={team ? teamHref(team, "portal") : `${platformUrl}/signup`}
            className="g3-nav-text-link text-sm"
          >
            {team ? "My team" : "Sign up your team"}
          </a>
          <ThemeToggle />
        </nav>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 md:flex-row md:gap-10 md:px-6 md:py-10">
        <aside className="md:sticky md:top-6 md:max-h-[calc(100vh-3rem)] md:w-64 md:shrink-0 md:overflow-y-auto">
          <div className="mb-4">{search}</div>
          <details className="group md:hidden">
            <summary className="cursor-pointer rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-secondary-900">
              Contents
            </summary>
            <div className="mt-3">
              <Contents base={base} current={current} />
            </div>
          </details>
          <div className="hidden md:block">
            <Contents base={base} current={current} />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          {query.trim() ? <SearchResults base={base} query={query} /> : children}
        </main>
      </div>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap gap-x-5 gap-y-2 px-6 py-6 text-sm text-secondary-500">
          <span>Gearbox is free and open source.</span>
          <a href={site.sourceUrl} className="hover:text-secondary-900">
            Source code
          </a>
          <a href={site.legal.terms} className="hover:text-secondary-900">
            Terms
          </a>
          <a href={site.legal.privacy} className="hover:text-secondary-900">
            Privacy
          </a>
        </div>
      </footer>
    </div>
  );
}

/** The sidebar: every section, with the current one's pages under it. */
function Contents({ base, current }: { base: string; current?: DocsPage }) {
  return (
    <nav aria-label="Docs" className="space-y-1 text-sm">
      {sections.map((section) => {
        const open = current?.section === section.id;
        return (
          <div key={section.id}>
            <Link
              to={`${base}/${section.id}`}
              aria-current={open && current?.slug === "" ? "page" : undefined}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 font-semibold ${
                open ? "text-secondary-900" : "text-secondary-600 hover:text-secondary-900"
              } ${open && current?.slug === "" ? "bg-inset" : ""}`}
            >
              {section.app && ICONS[section.app] && (
                <img src={ICONS[section.app]} alt="" className="h-5 w-5 rounded" />
              )}
              {section.title}
            </Link>
            {open && (
              <ul className="mb-2 ml-4 border-l border-line pl-2">
                {pagesOf(section.id)
                  .filter((p) => p.slug !== "")
                  .map((page) => (
                    <li key={page.slug}>
                      <Link
                        to={`${base}${pagePath(page)}`}
                        aria-current={current?.slug === page.slug ? "page" : undefined}
                        className={`block rounded-md px-2 py-1 ${
                          current?.slug === page.slug
                            ? "bg-inset font-medium text-secondary-900"
                            : "text-secondary-600 hover:text-secondary-900"
                        }`}
                      >
                        {page.title}
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function SearchResults({ base, query }: { base: string; query: string }) {
  const results = searchDocs(query);
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-secondary-900">Search</h1>
      {results.length === 0 ? (
        <p className="text-secondary-600">Nothing in the docs matches “{query.trim()}”.</p>
      ) : (
        <ul className="space-y-3">
          {results.map(({ page, snippet }) => (
            <li key={pagePath(page)}>
              <Link
                to={`${base}${pagePath(page)}`}
                className="block rounded-xl border border-line bg-surface p-4 hover:border-primary-500"
              >
                <span className="text-xs font-medium text-secondary-500">
                  {findSection(page.section)?.title}
                </span>
                <span className="block font-semibold text-secondary-900">{page.title}</span>
                <span className="mt-1 block text-sm text-secondary-600">{snippet}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Home({ base }: { base: string }) {
  useEffect(() => {
    document.title = "Gearbox Docs";
  }, []);
  const [start, ...rest] = sections;
  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-secondary-900 sm:text-4xl">Gearbox docs</h1>
        <p className="max-w-2xl text-lg text-secondary-600">
          How to set up your team on Gearbox and run each of its apps. Written for the mentors and
          students who look after their team's apps.
        </p>
      </div>
      {start && <SectionCard base={base} section={start} wide />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rest.map((section) => (
          <SectionCard key={section.id} base={base} section={section} />
        ))}
      </div>
    </div>
  );
}

function SectionCard({
  base,
  section,
  wide = false,
}: {
  base: string;
  section: DocsSection;
  wide?: boolean;
}) {
  const icon = section.app ? ICONS[section.app] : undefined;
  return (
    <Link
      to={`${base}/${section.id}`}
      className={`flex gap-4 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-primary-500 ${
        wide ? "items-center" : "flex-col"
      }`}
    >
      {icon && <img src={icon} alt="" className="h-10 w-10 rounded-lg" />}
      <span className="space-y-1">
        <span className="block text-lg font-semibold text-secondary-900">{section.title}</span>
        <span className="block text-sm text-secondary-600">{section.summary}</span>
      </span>
    </Link>
  );
}

function Article({ base }: { base: string }) {
  const { section: sectionId = "", slug = "" } = useParams();
  const page = findPage(sectionId, slug);
  const section = findSection(sectionId);
  const team = useTeam();
  const body = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { hash } = useLocation();

  useEffect(() => {
    if (page) document.title = `${page.title} · Gearbox Docs`;
  }, [page]);

  // Links, team links and checklists in the page's HTML.
  useEffect(() => {
    const root = body.current;
    if (!root || !page) return;
    for (const a of root.querySelectorAll<HTMLAnchorElement>("a[data-docs-link]")) {
      const to = a.getAttribute("href") ?? "/";
      a.dataset.to = to;
      a.href = `${base}${to}`;
    }
    for (const a of root.querySelectorAll<HTMLAnchorElement>("a[data-team-app]")) {
      a.href = teamHref(team, a.dataset.teamApp ?? "portal", a.dataset.teamPath);
    }
    // A setup page's checklist: ticks are kept in this browser, page by page.
    const key = `gearbox-docs:${pagePath(page)}`;
    let ticked: number[] = [];
    try {
      ticked = JSON.parse(localStorage.getItem(key) ?? "[]");
    } catch {}
    const boxes = [...root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    boxes.forEach((box, i) => {
      box.disabled = false;
      box.checked = ticked.includes(i);
      box.setAttribute("aria-label", "Done");
      box.onchange = () => {
        const now = boxes.flatMap((b, j) => (b.checked ? [j] : []));
        try {
          localStorage.setItem(key, JSON.stringify(now));
        } catch {}
      };
    });
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-docs-link]");
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(`${base}${a.dataset.to}`);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [page, base, team, navigate]);

  // A new page starts at its top, or at the heading its address names.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each new page or heading
  useEffect(() => {
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [page, hash]);

  if (!page || !section) return <Navigate to={base || "/"} replace />;

  const at = readingOrder.indexOf(page);
  const previous = readingOrder[at - 1];
  const next = readingOrder[at + 1];
  const children = page.slug === "" ? pagesOf(section.id).filter((p) => p.slug !== "") : [];

  return (
    <Shell base={base} current={page}>
      <div className="flex gap-10">
        <article className="min-w-0 max-w-3xl flex-1">
          {page.slug !== "" && (
            <Link
              to={`${base}/${section.id}`}
              className="text-sm font-medium text-secondary-500 hover:text-secondary-900"
            >
              {section.title}
            </Link>
          )}
          <h1 className="mt-1 text-3xl font-bold text-secondary-900">{page.title}</h1>
          {page.summary && <p className="mt-2 text-lg text-secondary-600">{page.summary}</p>}
          {section.app && page.slug === "" && (
            <a
              href={teamHref(team, section.app)}
              className={`${buttonClass("secondary", "sm")} mt-4 inline-flex`}
            >
              {team ? `Open it for team ${team}` : "Find your team"}
            </a>
          )}
          <div
            ref={body}
            className="docs-prose mt-6"
            // The docs' own Markdown, built into HTML from this repository's files.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: our own content
            dangerouslySetInnerHTML={{ __html: page.html }}
          />
          {children.length > 0 && (
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {children.map((child) => (
                <Link
                  key={child.slug}
                  to={`${base}${pagePath(child)}`}
                  className="rounded-xl border border-line bg-surface p-4 hover:border-primary-500"
                >
                  <span className="block font-semibold text-secondary-900">{child.title}</span>
                  <span className="mt-1 block text-sm text-secondary-600">{child.summary}</span>
                </Link>
              ))}
            </div>
          )}
          <div className="mt-12 flex flex-wrap justify-between gap-4 border-t border-line pt-6 text-sm">
            {previous ? (
              <Link
                to={`${base}${pagePath(previous)}`}
                className="text-secondary-600 hover:text-secondary-900"
              >
                ← {previous.title}
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link
                to={`${base}${pagePath(next)}`}
                className="text-secondary-600 hover:text-secondary-900"
              >
                {next.title} →
              </Link>
            )}
          </div>
          <a
            href={`${site.sourceUrl}/blob/main/${page.source}`}
            className="mt-6 inline-block text-sm text-secondary-500 hover:text-secondary-900"
          >
            Suggest a change to this page
          </a>
        </article>
        {page.headings.length > 1 && (
          <nav
            aria-label="On this page"
            className="sticky top-6 hidden max-h-[calc(100vh-3rem)] w-52 shrink-0 self-start overflow-y-auto text-sm xl:block"
          >
            <p className="mb-2 font-semibold text-secondary-900">On this page</p>
            <ul className="space-y-1">
              {page.headings.map((h) => (
                <li key={h.id} className={h.depth === 3 ? "pl-3" : ""}>
                  <a href={`#${h.id}`} className="text-secondary-600 hover:text-secondary-900">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </Shell>
  );
}
