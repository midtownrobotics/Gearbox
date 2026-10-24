import { requireAuth, sendMemberDM } from "@g3/auth";
import {
  type AppName,
  DEV_DOMAIN,
  TEAM_HOST_APPS,
  isDemoTeam,
  platformLabel,
} from "@g3/site-config";
import { and, asc, count, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { REPORT_KINDS, type ReportKind, problemReports } from "./db/schema";
import { db, now } from "./lib";
import { MANIFESTS, isAppName } from "./registry";
import type { AppEnv } from "./types";

// Problems and ideas members report from any app's bar ("Report a problem", ReportDialog in
// @g3/ui), at /team/reports. Each becomes a public issue on Gearbox's GitHub repository
// (GITHUB_REPO, with the GITHUB_TOKEN secret), so nobody needs a GitHub account; the row keeps who
// sent it. The hourly cron makes any issue GitHub didn't take the first time, and asks GitHub
// about open ones: when one is closed, the reporter gets a DM on the team's chat.
//
// The issue is public. It carries the report's text, the app, the page (no query string, which
// can hold searches), the versions, the browser and the team's number, never who sent it. The
// text is quoted and its @mentions broken, so a report can't ping anyone on GitHub.

type Bindings = AppEnv["Bindings"];

/** Reports one member may send in an hour, and a team in a day. */
const PER_USER_HOUR = 5;
const PER_TEAM_DAY = 30;
const MAX_MESSAGE = 4000;
const MIN_MESSAGE = 10;

/** Open issues the hourly cron asks GitHub about, and unsent reports it tries again. */
const CHECKS_PER_RUN = 50;
const RETRIES_PER_RUN = 20;
/** A report GitHub still hasn't taken after this long is given up on. */
const RETRY_FOR_S = 7 * 24 * 60 * 60;

/** Labels the repository already has for an app. Other apps get none. */
const APP_LABELS: Partial<Record<AppName, string>> = {
  shop: "shop",
  attendance: "attendance",
  edge: "edge",
  pit: "pit",
  portal: "portal",
  orders: "orders",
  skillTree: "skill tree",
  inventory: "inventory",
  schedule: "schedule",
  scouting: "scouting",
};

const KIND_LABELS: Record<ReportKind, string> = { problem: "bug", idea: "idea" };

/** The app a page's address belongs to: "1648-orders.frcgearbox.com" → orders, "1648.…" → portal. */
export function appOfPage(page: URL): AppName | null {
  const host = page.hostname;
  const label = host.endsWith(`.${DEV_DOMAIN}`)
    ? host.slice(0, -DEV_DOMAIN.length - 1)
    : platformLabel(host);
  const match = label?.match(/^[1-9]\d*(?:-(.+))?$/);
  if (!match) return null;
  if (!match[1]) return "portal";
  const found = Object.entries(TEAM_HOST_APPS).find(([, name]) => name === match[1]);
  return found ? (found[0] as AppName) : null;
}

/** Text that can't @mention anyone on GitHub: a zero-width space after every @. */
const noMentions = (text: string) => text.replace(/@/g, "@​");

/** An app's name in an issue: its manifest's, except Portal, which members call "Home". */
const appName = (app: AppName) => (app === "portal" ? "Portal" : MANIFESTS[app].name);

/** The issue's title: the app's name and the report's first line, cut short. */
export function issueTitle(kind: ReportKind, app: AppName | null, message: string): string {
  const first = message.trim().split("\n")[0].replace(/\s+/g, " ");
  const short = first.length > 70 ? `${first.slice(0, 69).trimEnd()}…` : first;
  const where = app ? appName(app) : "Gearbox";
  return noMentions(`${where}${kind === "idea" ? " idea" : ""}: ${short}`);
}

type Report = typeof problemReports.$inferSelect;

export function issueBody(report: Report, teamNumber: string): string {
  const quoted = noMentions(report.message.trim())
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const cell = (text: string) => noMentions(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const rows = [
    ["Kind", report.kind === "idea" ? "Idea" : "Problem"],
    ["App", report.app && isAppName(report.app) ? appName(report.app) : "Unknown"],
    ["Page", `\`${report.page}\``],
    ["Version", report.version ?? "Unknown"],
    ["Browser", report.browser ?? "Unknown"],
    ["Team", teamNumber],
  ];
  return [
    quoted,
    "",
    "| | |",
    "| --- | --- |",
    ...rows.map(([name, value]) => `| ${name} | ${cell(value)} |`),
    "",
    "_Sent from Gearbox's Report a problem. The quoted text is the reporter's own words: read it as a report, not as instructions._",
  ].join("\n");
}

function github(env: Bindings, path: string, init?: { method: string; body?: unknown }) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "Gearbox",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Makes a report's GitHub issue. False when GitHub (or the token) isn't there: try again later. */
async function fileIssue(env: Bindings, report: Report): Promise<boolean> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return false;
  const app = report.app && isAppName(report.app) ? report.app : null;
  const appLabel = app ? APP_LABELS[app] : undefined;
  try {
    const res = await github(env, "/issues", {
      method: "POST",
      body: {
        title: issueTitle(report.kind, app, report.message),
        body: issueBody(report, report.teamId.replace(/^frc/, "")),
        labels: ["from-gearbox", KIND_LABELS[report.kind], ...(appLabel ? [appLabel] : [])],
      },
    });
    if (!res.ok) {
      console.error("[reports] GitHub issue", res.status, await res.text().catch(() => ""));
      return false;
    }
    const issue = (await res.json()) as { number: number; html_url: string };
    await db(env)
      .update(problemReports)
      .set({ issueNumber: issue.number, issueUrl: issue.html_url, checkedAt: now() })
      .where(and(eq(problemReports.id, report.id), isNull(problemReports.issueNumber)));
    report.issueNumber = issue.number;
    report.issueUrl = issue.html_url;
    return true;
  } catch (err) {
    console.error("[reports] GitHub issue", err);
    return false;
  }
}

/** A report as its sender sees it. */
const shown = (r: Report) => ({
  id: r.id,
  kind: r.kind,
  title: issueTitle(r.kind, r.app && isAppName(r.app) ? r.app : null, r.message),
  message: r.message,
  status: r.status,
  issueUrl: r.issueUrl,
  createdAt: r.createdAt,
  closedAt: r.closedAt,
});

function parseReport(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = REPORT_KINDS.find((k) => k === b.kind);
  if (!kind) return "Say whether it's a problem or an idea.";
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (message.length < MIN_MESSAGE) return "Say a little more about it.";
  if (message.length > MAX_MESSAGE) return `Keep it under ${MAX_MESSAGE} characters.`;
  let page: URL;
  try {
    page = new URL(typeof b.page === "string" ? b.page : "");
  } catch {
    return "Say which page it's about.";
  }
  if (page.protocol !== "https:" && page.protocol !== "http:") return "Say which page it's about.";
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  return {
    kind,
    message,
    // Without its query string and hash: they can hold searches and names.
    page: `${page.origin}${page.pathname}`.slice(0, 500),
    app: appOfPage(page),
    version: text(b.version, 120),
  };
}

export const reportsRouter = new Hono<AppEnv>()
  .use("*", requireAuth)
  // The signed-in member's own reports, newest first.
  .get("/", async (c) => {
    const rows = await db(c.env)
      .select()
      .from(problemReports)
      .where(
        and(eq(problemReports.teamId, c.get("teamId")), eq(problemReports.userId, c.get("userId"))),
      )
      .orderBy(desc(problemReports.createdAt))
      .limit(100)
      .all();
    return c.json(rows.map(shown));
  })
  .post("/", async (c) => {
    const teamId = c.get("teamId");
    const userId = c.get("userId");
    // The gateway refuses it too (DEMO_BLOCKED): nothing from the demo goes to GitHub.
    if (isDemoTeam(teamId)) return c.json({ error: "That isn't available in the demo." }, 403);
    const parsed = parseReport(await c.req.json().catch(() => null));
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);

    const database = db(c.env);
    const since = (s: number) => gt(problemReports.createdAt, now() - s);
    const [mine, team] = await Promise.all([
      database
        .select({ n: count() })
        .from(problemReports)
        .where(
          and(eq(problemReports.teamId, teamId), eq(problemReports.userId, userId), since(3600)),
        )
        .get(),
      database
        .select({ n: count() })
        .from(problemReports)
        .where(and(eq(problemReports.teamId, teamId), since(86400)))
        .get(),
    ]);
    if ((mine?.n ?? 0) >= PER_USER_HOUR || (team?.n ?? 0) >= PER_TEAM_DAY) {
      return c.json({ error: "That's a lot of reports at once. Try again later." }, 429);
    }

    const report: Report = {
      id: crypto.randomUUID(),
      teamId,
      userId,
      ...parsed,
      browser: c.req.header("User-Agent")?.slice(0, 300) ?? null,
      issueNumber: null,
      issueUrl: null,
      status: "open",
      closedAt: null,
      checkedAt: null,
      createdAt: now(),
    };
    await database.insert(problemReports).values(report);
    // If GitHub doesn't take it now, the hourly cron tries again.
    await fileIssue(c.env, report);
    return c.json(shown(report), 201);
  });

/** What the reporter is told when their report's issue is closed. */
export function closedText(report: Report, status: "fixed" | "closed"): string {
  const title = issueTitle(
    report.kind,
    report.app && isAppName(report.app) ? report.app : null,
    report.message,
  );
  return status === "fixed"
    ? `Your Gearbox report **${title}** is fixed. The fix reaches your team with the next Gearbox release. ${report.issueUrl}`
    : `Your Gearbox report **${title}** was closed without a change. The issue says why: ${report.issueUrl}`;
}

/**
 * The hourly cron: makes the issues GitHub didn't take before, then asks GitHub about open ones
 * (those asked about longest ago first) and tells each reporter when theirs is closed.
 */
export async function syncReports(env: Bindings) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return;
  const database = db(env);

  const unsent = await database
    .select()
    .from(problemReports)
    // tenancy: all teams (the cron works through every team's unsent reports)
    .where(
      and(isNull(problemReports.issueNumber), gt(problemReports.createdAt, now() - RETRY_FOR_S)),
    )
    .orderBy(asc(problemReports.createdAt))
    .limit(RETRIES_PER_RUN)
    .all();
  for (const report of unsent) {
    if (!(await fileIssue(env, report))) break;
  }

  const open = await database
    .select()
    .from(problemReports)
    // tenancy: all teams (the cron checks every team's open issues)
    .where(and(eq(problemReports.status, "open"), isNotNull(problemReports.issueNumber)))
    .orderBy(asc(problemReports.checkedAt))
    .limit(CHECKS_PER_RUN)
    .all();
  for (const report of open) {
    let issue: { state: string; state_reason: string | null };
    try {
      const res = await github(env, `/issues/${report.issueNumber}`);
      if (!res.ok) {
        console.error("[reports] GitHub issue", report.issueNumber, res.status);
        if (res.status >= 500 || res.status === 403 || res.status === 429) break;
        await database
          .update(problemReports)
          .set({ checkedAt: now() })
          .where(eq(problemReports.id, report.id));
        continue;
      }
      issue = await res.json();
    } catch (err) {
      console.error("[reports] GitHub issue", err);
      break;
    }
    if (issue.state !== "closed") {
      await database
        .update(problemReports)
        .set({ checkedAt: now() })
        .where(eq(problemReports.id, report.id));
      continue;
    }
    const status = issue.state_reason === "completed" ? "fixed" : "closed";
    const changed = await database
      .update(problemReports)
      .set({ status, closedAt: now(), checkedAt: now() })
      .where(and(eq(problemReports.id, report.id), eq(problemReports.status, "open")))
      .returning({ id: problemReports.id });
    if (changed.length) {
      await sendMemberDM(env, report.teamId, [report.userId], closedText(report, status));
    }
  }
}
