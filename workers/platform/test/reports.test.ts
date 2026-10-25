import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { site } from "@g3/site-config";
import { type TestUser, admin, asUser, teamUsers } from "@g3/testing/users";
import { beforeAll, describe, expect, it } from "vitest";
import { appOfPage, syncReports } from "../src/reports";
import type { AppEnv } from "../src/types";

// Members' reports (src/reports.ts): each becomes an issue on GitHub's "test/gearbox", faked in
// vitest.config.mts, and the reporter is DMed when it's closed (G3ID's stub records DMs).

const testEnv = env as unknown as AppEnv["Bindings"];

const newTeam = () =>
  teamUsers(`frc${20000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 70000)}`);

function call(user: TestUser, path: string, init: { method?: string; body?: unknown } = {}) {
  return exports.default.fetch(new Request(`http://platform/api${path}`, asUser(user, init)));
}

const send = (user: TestUser, body: Record<string, unknown> = {}) =>
  call(user, "/team/reports", {
    method: "POST",
    body: {
      kind: "problem",
      message: "The Approve button does nothing on my phone.",
      page: "https://1648-orders.frcgearbox.com/approvals?search=Jordan#row",
      version: "Orders 1.4.0 · platform 2026.10.4",
      ...body,
    },
  });

type Shown = { id: string; title: string; status: string; issueUrl: string | null };

const github = (path: string, method = "GET") =>
  fetch(`https://api.github.com${path}`, { method }).then((r) => r.json()) as Promise<{
    title: string;
    body: string;
    labels: string[];
  }>;
const issueOf = (report: Shown) => Number(report.issueUrl?.split("/").pop());

/** Moves every report of the team `seconds` in time (negative: earlier). */
const moveTeamReports = (teamId: string, seconds: number) =>
  testEnv.PLATFORM_DB.prepare(
    "UPDATE problem_reports SET created_at = created_at + ? WHERE team_id = ?",
  )
    .bind(seconds, teamId)
    .run();

/** The reporter ID on a report's issue. */
const reporterOf = async (report: Shown) =>
  (await github(`/test/issues/${issueOf(report)}`)).body.match(/\| Reporter \| (\w+) \|/)?.[1];

/** `admin` is an operator; the console's changes come from its own address. */
const operator = admin;
const consoleCall = (path: string, body?: unknown) =>
  exports.default.fetch(
    new Request(
      `http://platform/api/console${path}`,
      asUser(operator, {
        method: body === undefined ? "GET" : "POST",
        body,
        headers: { Origin: `https://admin.${site.platformDomain}` },
      }),
    ),
  );

beforeAll(async () => {
  await testEnv.PLATFORM_DB.prepare(
    "INSERT OR IGNORE INTO operators (user_id, created_at) VALUES (?, 1)",
  )
    .bind(operator.id)
    .run();
});

const dmsTo = async (teamId: string) =>
  (await (
    await testEnv.G3ID.fetch(`http://g3id/api/internal/teams/${teamId}/chat/dm-members`)
  ).json()) as { userIds: string[]; text: string }[];

describe("reporting a problem", () => {
  it("makes a public GitHub issue with the page, versions and team, never who sent it", async () => {
    const team = newTeam();
    const res = await send(team.student, {
      message: "Ping @someone: the Approve button is broken",
    });
    expect(res.status).toBe(201);
    const report = (await res.json()) as Shown;
    expect(report.status).toBe("open");
    expect(report.issueUrl).toMatch(/^https:\/\/github\.com\/test\/gearbox\/issues\/\d+$/);

    const issue = await github(`/test/issues/${issueOf(report)}`);
    expect(issue.title).toBe("Orders: Ping @​someone: the Approve button is broken");
    expect(issue.labels).toEqual(["from-gearbox", "bug", "orders"]);
    expect(issue.body).toMatch(/^Ping @​someone: the Approve button is broken\n/);
    expect(issue.body).not.toContain("> Ping");
    // A real header, not an empty row.
    expect(issue.body).toContain("| Detail | Value |\n| --- | --- |\n| Kind | Problem |");
    expect(issue.body).toContain("`https://1648-orders.frcgearbox.com/approvals`");
    expect(issue.body).not.toContain("Jordan");
    expect(issue.body).toContain("Orders 1.4.0");
    expect(issue.body).toContain(`| Team | ${team.student.teamId.replace("frc", "")} |`);
    expect(issue.body).not.toContain(team.student.id);
  });

  it("puts the member's name on the issue only when they choose to", async () => {
    const team = newTeam();
    const named = (await (await send(team.student, { withName: true })).json()) as Shown & {
      withName: boolean;
    };
    expect(named.withName).toBe(true);
    expect((await github(`/test/issues/${issueOf(named)}`)).body).toContain(
      `| Name | ${team.student.displayName} |`,
    );
    const unnamed = (await (await send(team.student, { withName: "yes" })).json()) as Shown & {
      withName: boolean;
    };
    expect(unnamed.withName).toBe(false);
    const body = (await github(`/test/issues/${issueOf(unnamed)}`)).body;
    expect(body).not.toContain("| Name |");
    expect(body).not.toContain(team.student.displayName);
  });

  it("uses the member's title for the issue when they give one", async () => {
    const team = newTeam();
    const titled = (await (
      await send(team.student, { title: "  Approve\nbutton   broken ", kind: "idea" })
    ).json()) as Shown;
    expect(titled.title).toBe("Orders idea: Approve button broken");
    expect((await github(`/test/issues/${issueOf(titled)}`)).title).toBe(
      "Orders idea: Approve button broken",
    );
    const untitled = (await (await send(team.student, { title: "   " })).json()) as Shown;
    expect(untitled.title).toBe("Orders: The Approve button does nothing on my phone.");
  });

  it("lists each member's own reports only", async () => {
    const team = newTeam();
    const sent = (await (await send(team.student)).json()) as Shown;
    const mine = (await (await call(team.student, "/team/reports")).json()) as Shown[];
    expect(mine.map((r) => r.id)).toEqual([sent.id]);
    const theirs = (await (await call(team.mentor, "/team/reports")).json()) as Shown[];
    expect(theirs).toEqual([]);
  });

  it("needs a kind, some words and a page, and a signed-in member", async () => {
    const team = newTeam();
    expect((await send(team.student, { kind: "rant" })).status).toBe(400);
    expect((await send(team.student, { message: "broken" })).status).toBe(400);
    expect((await send(team.student, { page: "javascript:alert(1)" })).status).toBe(400);
    const res = await exports.default.fetch(
      new Request("http://platform/api/team/reports", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(401);
  });

  it("lets a team send 5 a day, then one every 10 minutes", async () => {
    const team = newTeam();
    for (let i = 0; i < 5; i++) expect((await send(team.admin)).status).toBe(201);
    const slowed = await send(team.student);
    expect(slowed.status).toBe(429);
    expect(((await slowed.json()) as { error: string }).error).toContain("Try again in 10 minutes");

    // 11 minutes later, one more, then another wait.
    await moveTeamReports(team.admin.teamId, -11 * 60);
    expect((await send(team.student)).status).toBe(201);
    expect((await send(team.mentor)).status).toBe(429);
  });

  it("starts each team's day afresh at midnight UTC", async () => {
    const team = newTeam();
    for (let i = 0; i < 5; i++) expect((await send(team.student)).status).toBe(201);
    expect((await send(team.mentor)).status).toBe(429);
    // Yesterday's: the time since midnight, and a minute more.
    const sinceMidnight = Math.floor(Date.now() / 1000) % 86400;
    await moveTeamReports(team.student.teamId, -(sinceMidnight + 60));
    for (let i = 0; i < 5; i++) expect((await send(team.mentor)).status).toBe(201);
  });

  it("limits how many one member sends in an hour", async () => {
    const team = newTeam();
    for (let i = 0; i < 5; i++) expect((await send(team.admin)).status).toBe(201);
    // Past the team's wait, but not the hour.
    await moveTeamReports(team.admin.teamId, -11 * 60);
    expect((await send(team.admin)).status).toBe(429);
    expect((await send(team.student)).status).toBe(201);
  });

  it("isn't open to the public demo", async () => {
    const demo = teamUsers("frc9999");
    expect((await send(demo.admin)).status).toBe(403);
  });
});

describe("reporter IDs", () => {
  it("stand for the same member on each of their issues, and never are their account id", async () => {
    const team = newTeam();
    const first = await reporterOf((await (await send(team.student)).json()) as Shown);
    const again = await reporterOf((await (await send(team.student)).json()) as Shown);
    const other = await reporterOf((await (await send(team.mentor)).json()) as Shown);
    expect(first).toMatch(/^[0-9a-f]{10}$/);
    expect(again).toBe(first);
    expect(other).not.toBe(first);
    expect(first).not.toContain(team.student.id);
  });

  it("let an operator block a reporter without learning who it is", async () => {
    const team = newTeam();
    const id = await reporterOf((await (await send(team.student)).json()) as Shown);

    expect((await consoleCall(`/reporters/${id}`, { blocked: true })).status).toBe(400);
    expect(
      (await consoleCall("/reporters/0000000000", { blocked: true, reason: "x" })).status,
    ).toBe(404);
    const res = await consoleCall(`/reporters/${id}`, { blocked: true, reason: "Spam" });
    expect(res.status).toBe(200);

    const list = await (await consoleCall("/reporters")).text();
    expect(list).toContain(id);
    expect(list).not.toContain(team.student.id);
    // Their team's number, which their issues show too.
    expect(list).toContain(`"teamNumber":${team.student.teamId.replace("frc", "")}`);

    expect((await send(team.student)).status).toBe(403);
    expect((await send(team.mentor)).status).toBe(201);

    expect((await consoleCall(`/reporters/${id}`, { blocked: false })).status).toBe(200);
    expect((await send(team.student)).status).toBe(201);
  });

  it("tell the team's admins who was blocked and why, with a link to their page", async () => {
    const team = newTeam();
    const id = await reporterOf((await (await send(team.student)).json()) as Shown);
    await consoleCall(`/reporters/${id}`, {
      blocked: true,
      reason: "Posted the same spam 40 times",
    });
    await consoleCall(`/reporters/${id}`, { blocked: false });

    const dms = (await (
      await testEnv.G3ID.fetch(
        `http://g3id/api/internal/teams/${team.student.teamId}/chat/dm-admins`,
      )
    ).json()) as { text: string }[];
    const [blocked, unblocked] = dms.map((d) => d.text);
    expect(blocked).toContain(`blocked reporter ID \`${id}\``);
    expect(blocked).toContain(`**Name of ${team.student.id}**`);
    expect(blocked).toContain(`/admin/members/${team.student.id}`);
    expect(blocked).toContain("> Posted the same spam 40 times");
    expect(unblocked).toContain(`unblocked reporter ID \`${id}\``);
  });

  it("are shown to their member, and to the team's admins with whose each is", async () => {
    const team = newTeam();
    const id = await reporterOf((await (await send(team.student)).json()) as Shown);
    const mine = (await (await call(team.student, "/team/reports/reporter")).json()) as {
      id: string;
      blocked: boolean;
    };
    expect(mine).toMatchObject({ id, blocked: false });
    expect(JSON.stringify(mine)).not.toContain(team.student.id);

    // A member who never reported gets one when the form asks.
    const fresh = (await (await call(team.mentor, "/team/reports/reporter")).json()) as {
      id: string;
    };
    expect(fresh.id).toMatch(/^[0-9a-f]{10}$/);

    expect((await call(team.student, "/team/reports/reporters")).status).toBe(403);
    const all = (await (await call(team.admin, "/team/reports/reporters")).json()) as {
      id: string;
      userId: string;
    }[];
    expect(all).toContainEqual(expect.objectContaining({ id, userId: team.student.id }));
    expect(all).toContainEqual(expect.objectContaining({ id: fresh.id, userId: team.mentor.id }));

    // Another team's admin sees none of them.
    const other = newTeam();
    const theirs = await (await call(other.admin, "/team/reports/reporters")).text();
    expect(theirs).not.toContain(id);
  });

  it("only operators block, from the console", async () => {
    const team = newTeam();
    const id = await reporterOf((await (await send(team.student)).json()) as Shown);
    const res = await call(team.admin, `/console/reporters/${id}`, {
      method: "POST",
      body: { blocked: true, reason: "Spam" },
    });
    expect(res.status).toBe(403);
  });
});

describe("the hourly check", () => {
  it("makes the issues GitHub didn't take the first time", async () => {
    const team = newTeam();
    await fetch("https://api.github.com/test/down?on=1", { method: "POST" });
    const report = (await (await send(team.student)).json()) as Shown;
    await fetch("https://api.github.com/test/down?on=0", { method: "POST" });
    expect(report.issueUrl).toBeNull();

    await syncReports(testEnv);
    const [now] = (await (await call(team.student, "/team/reports")).json()) as Shown[];
    expect(now.issueUrl).toMatch(/issues\/\d+$/);
  });

  it("never sends a blocked reporter's unsent reports", async () => {
    const team = newTeam();
    const id = await reporterOf((await (await send(team.student)).json()) as Shown);
    await fetch("https://api.github.com/test/down?on=1", { method: "POST" });
    await send(team.student);
    await fetch("https://api.github.com/test/down?on=0", { method: "POST" });
    await consoleCall(`/reporters/${id}`, { blocked: true, reason: "Spam" });

    await syncReports(testEnv);
    const [unsent] = (await (await call(team.student, "/team/reports")).json()) as Shown[];
    expect(unsent.issueUrl).toBeNull();
  });

  it("tells the reporter once when their issue is fixed or closed", async () => {
    const team = newTeam();
    const fixed = (await (await send(team.student)).json()) as Shown;
    const dropped = (await (await send(team.mentor, { kind: "idea" })).json()) as Shown;
    await github(`/test/issues/${issueOf(fixed)}/close?reason=completed`, "POST");
    await github(`/test/issues/${issueOf(dropped)}/close?reason=not_planned`, "POST");

    await syncReports(testEnv);
    await syncReports(testEnv);

    const [mine] = (await (await call(team.student, "/team/reports")).json()) as Shown[];
    expect(mine.status).toBe("fixed");
    const [theirs] = (await (await call(team.mentor, "/team/reports")).json()) as Shown[];
    expect(theirs.status).toBe("closed");

    const dms = await dmsTo(team.student.teamId);
    expect(dms).toHaveLength(2);
    expect(dms.find((d) => d.userIds[0] === team.student.id)?.text).toContain("is fixed");
    expect(dms.find((d) => d.userIds[0] === team.mentor.id)?.text).toContain("without a change");
  });
});

describe("appOfPage", () => {
  it("reads the app from a team's address", () => {
    const of = (url: string) => appOfPage(new URL(url));
    expect(of("https://1648-orders.frcgearbox.com/x")).toBe("orders");
    expect(of("https://1648-skill-tree.frcgearbox.com/")).toBe("skillTree");
    expect(of("https://1648.frcgearbox.com/admin")).toBe("portal");
    expect(of("http://254-pit.gearbox.localhost:8796/")).toBe("pit");
    expect(of("https://example.com/")).toBeNull();
  });
});
