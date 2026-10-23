import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { type TestUser, asUser, teamUsers } from "@g3/testing/users";
import { describe, expect, it } from "vitest";
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
    expect(issue.body).toContain("> Ping @​someone");
    expect(issue.body).toContain("`https://1648-orders.frcgearbox.com/approvals`");
    expect(issue.body).not.toContain("Jordan");
    expect(issue.body).toContain("Orders 1.4.0");
    expect(issue.body).toContain(`| Team | ${team.student.teamId.replace("frc", "")} |`);
    expect(issue.body).not.toContain(team.student.id);
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

  it("limits how many one member sends in an hour", async () => {
    const team = newTeam();
    for (let i = 0; i < 5; i++) expect((await send(team.admin)).status).toBe(201);
    expect((await send(team.admin)).status).toBe(429);
    expect((await send(team.student)).status).toBe(201);
  });

  it("isn't open to the public demo", async () => {
    const demo = teamUsers("frc9999");
    expect((await send(demo.admin)).status).toBe(403);
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
