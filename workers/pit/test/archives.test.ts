import { type TeamUsers, newTeamId, teamUsers } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { nexusNextMatch, tbaMatchLabel } from "../src/archives";

// Checklist archives: "Archive and Reset" saves the checklists as they stand, unchecks every item
// and leaves open issues; the Logs page reads the archives back. A resolved issue is kept until
// the next archive has said so. Each test has a team of its own, so "the archive before" is always
// one the test made.

type Header = {
  id: number;
  event: string;
  type: string;
  details: string;
  archivedAt: number;
  archivedByName: string;
};
type Issue = { id: number; text: string; status: "new" | "open" | "resolved" };
type Item = { id: number; type: string; name: string; checked: boolean; issues: Issue[] };
type Archive = Header & { snapshot: { lists: { id: number; name: string; items: Item[] }[] } };

const newTeam = () => teamUsers(newTeamId());

async function addList(team: TeamUsers, name: string) {
  return jsonAs<{ id: number }>(team.student, "/lists", { method: "POST", body: { name } }, 201);
}

async function addItem(team: TeamUsers, listId: number, name: string, type = "item") {
  return jsonAs<{ id: number }>(
    team.student,
    `/lists/${listId}/items`,
    { method: "POST", body: { name, type } },
    201,
  );
}

async function check(team: TeamUsers, listId: number, itemId: number) {
  await jsonAs(team.student, `/lists/${listId}/items/${itemId}/checked`, {
    method: "PATCH",
    body: { checked: true },
  });
}

async function report(team: TeamUsers, listId: number, itemId: number, text: string) {
  return jsonAs<{ id: number }>(
    team.student,
    `/lists/${listId}/items/${itemId}/issues`,
    { method: "POST", body: { text } },
    201,
  );
}

/** Archives and resets, and gives the archive back as the Logs page reads it. */
async function archive(team: TeamUsers, body: Record<string, unknown> = { type: "other" }) {
  const made = await jsonAs<Header>(team.student, "/archives", { method: "POST", body }, 201);
  return jsonAs<Archive>(team.student, `/archives/${made.id}`);
}

const issuesOf = (a: Archive) =>
  a.snapshot.lists.flatMap((l) => l.items.flatMap((i) => i.issues.map((x) => [x.text, x.status])));

describe("archive and reset", () => {
  it("needs a G3ID session", async () => {
    expect((await call("/archives")).status).toBe(401);
    expect((await call("/archives", { method: "POST" })).status).toBe(401);
    expect((await call("/archives/defaults")).status).toBe(401);
    expect((await call("/archives/next-match")).status).toBe(401);
  });

  it("saves every list as it stands, says who archived it, and unchecks everything", async () => {
    const team = newTeam();
    const robot = await addList(team, "Robot");
    const cart = await addList(team, "Cart");
    const heading = await addItem(team, robot.id, "Drivetrain", "topic");
    const bumpers = await addItem(team, robot.id, "Bumpers on");
    const battery = await addItem(team, robot.id, "Battery strapped");
    const tools = await addItem(team, cart.id, "Tools packed");
    await check(team, robot.id, bumpers.id);
    await check(team, cart.id, tools.id);
    await report(team, robot.id, battery.id, "Strap is frayed");

    const before = Math.floor(Date.now() / 1000);
    const made = await jsonAs<Header>(
      team.student,
      "/archives",
      { method: "POST", body: { event: " Shop ", type: "practice", details: " Drive practice " } },
      201,
    );
    expect(made).toMatchObject({
      event: "Shop",
      type: "practice",
      details: "Drive practice",
      archivedByName: team.student.displayName,
    });
    expect(made.archivedAt).toBeGreaterThanOrEqual(before);

    // The list of archives has no snapshots; one archive has every list in one answer.
    const listed = await jsonAs<{ archives: Header[]; more: boolean }>(team.student, "/archives");
    expect(listed).toEqual({ archives: [made], more: false });
    const saved = await jsonAs<Archive>(team.student, `/archives/${made.id}`);
    expect(saved.snapshot.lists.map((l) => l.name)).toEqual(["Robot", "Cart"]);
    expect(saved.snapshot.lists[0].items).toMatchObject([
      { id: heading.id, type: "topic", name: "Drivetrain", checked: false, issues: [] },
      { id: bumpers.id, type: "item", name: "Bumpers on", checked: true, issues: [] },
      {
        id: battery.id,
        name: "Battery strapped",
        checked: false,
        issues: [{ text: "Strap is frayed", status: "new" }],
      },
    ]);
    expect(saved.snapshot.lists[1].items).toMatchObject([{ name: "Tools packed", checked: true }]);

    // Every check is cleared; the open issue is still there.
    for (const list of [robot, cart]) {
      const items = await jsonAs<{ checked: boolean }[]>(team.student, `/lists/${list.id}/items`);
      expect(items.every((item) => !item.checked)).toBe(true);
    }
    expect(await jsonAs<unknown[]>(team.student, "/issues")).toHaveLength(1);
  });

  it("keeps an archive as it was after the lists change", async () => {
    const team = newTeam();
    const list = await addList(team, "Robot");
    const item = await addItem(team, list.id, "Bumpers on");
    await check(team, list.id, item.id);
    const first = await archive(team);
    await callAs(team.student, `/lists/${list.id}/items/${item.id}/name`, {
      method: "PATCH",
      body: { name: "Bumpers pinned" },
    });
    await callAs(team.student, `/lists/${list.id}`, { method: "DELETE" });
    const again = await jsonAs<Archive>(team.student, `/archives/${first.id}`);
    expect(again.snapshot.lists).toMatchObject([
      { name: "Robot", items: [{ name: "Bumpers on", checked: true }] },
    ]);
  });

  it("lets a kiosk session archive", async () => {
    const team = newTeam();
    const res = await callAs(team.kioskAdmin, "/archives", {
      method: "POST",
      body: { type: "other" },
    });
    expect(res.status).toBe(201);
  });

  it("refuses a type it doesn't know, text that's too long and ids that aren't archives", async () => {
    const team = newTeam();
    const post = (body: unknown) => callAs(team.student, "/archives", { method: "POST", body });
    expect((await post({ type: "scrimmage" })).status).toBe(400);
    expect((await post({ type: "match", details: 12 })).status).toBe(400);
    expect((await post({ type: "match", details: "x".repeat(121) })).status).toBe(400);
    expect((await post({ type: "match", event: "x".repeat(61) })).status).toBe(400);
    expect((await callAs(team.student, "/archives/nope")).status).toBe(400);
    expect((await callAs(team.student, "/archives/999999")).status).toBe(404);
    expect(await jsonAs(team.student, "/archives")).toEqual({ archives: [], more: false });
  });
});

describe("issues in an archive", () => {
  it("are new, then still open, then resolved, then gone", async () => {
    const team = newTeam();
    const list = await addList(team, "Robot");
    const item = await addItem(team, list.id, "Intake");
    const belt = await report(team, list.id, item.id, "Belt is loose");

    // Reported since the archive before (there is none) and open.
    expect(issuesOf(await archive(team))).toEqual([["Belt is loose", "new"]]);

    // Open at the archive before and still open; another one reported since.
    await report(team, list.id, item.id, "Roller is cracked");
    expect(issuesOf(await archive(team))).toEqual([
      ["Belt is loose", "open"],
      ["Roller is cracked", "new"],
    ]);

    // Resolved since the archive before: the next archive says so.
    await jsonAs(team.student, `/lists/${list.id}/items/${item.id}/issues/${belt.id}`, {
      method: "DELETE",
    });
    expect(issuesOf(await archive(team))).toEqual([
      ["Belt is loose", "resolved"],
      ["Roller is cracked", "open"],
    ]);

    // Resolved is said once.
    expect(issuesOf(await archive(team))).toEqual([["Roller is cracked", "open"]]);
  });

  it("show one reported and resolved between two archives as resolved, once", async () => {
    const team = newTeam();
    const list = await addList(team, "Robot");
    const item = await addItem(team, list.id, "Intake");
    const resolve = (issueId: number) =>
      callAs(team.student, `/lists/${list.id}/items/${item.id}/issues/${issueId}`, {
        method: "DELETE",
      });

    // Before the team's first archive counts too.
    const early = await report(team, list.id, item.id, "Wire is loose");
    expect((await resolve(early.id)).status).toBe(200);
    expect(issuesOf(await archive(team))).toEqual([["Wire is loose", "resolved"]]);

    const quick = await report(team, list.id, item.id, "Bolt missing");
    const stays = await report(team, list.id, item.id, "Roller is cracked");
    expect((await resolve(quick.id)).status).toBe(200);
    // Resolved: no longer among the open issues, and it can't be resolved twice.
    const open = await jsonAs<{ id: number }[]>(team.student, "/issues");
    expect(open.map((issue) => issue.id)).toEqual([stays.id]);
    const inList = await jsonAs<{ id: number }[]>(team.student, `/lists/${list.id}/issues`);
    expect(inList.map((issue) => issue.id)).toEqual([stays.id]);
    expect((await resolve(quick.id)).status).toBe(404);

    expect(issuesOf(await archive(team))).toEqual([
      ["Bolt missing", "resolved"],
      ["Roller is cracked", "new"],
    ]);
    expect(issuesOf(await archive(team))).toEqual([["Roller is cracked", "open"]]);
  });

  it("leave out an issue whose item is gone", async () => {
    const team = newTeam();
    const list = await addList(team, "Robot");
    const removed = await addItem(team, list.id, "Old sensor");
    await report(team, list.id, removed.id, "Wire is pinched");
    const fixed = await report(team, list.id, removed.id, "Bracket is bent");
    await archive(team);

    await jsonAs(team.student, `/lists/${list.id}/items/${removed.id}/issues/${fixed.id}`, {
      method: "DELETE",
    });
    await jsonAs(team.student, `/lists/${list.id}/items/${removed.id}`, { method: "DELETE" });
    expect(issuesOf(await archive(team))).toEqual([]);
  });

  it("record any number of resolved issues", async () => {
    const team = newTeam();
    const list = await addList(team, "Robot");
    const item = await addItem(team, list.id, "Intake");
    // More than one statement can name (D1 allows 100 bound values).
    for (let i = 0; i < 95; i++) {
      const issue = await report(team, list.id, item.id, `Issue ${i}`);
      await jsonAs(team.student, `/lists/${list.id}/items/${item.id}/issues/${issue.id}`, {
        method: "DELETE",
      });
    }
    const recorded = issuesOf(await archive(team));
    expect(recorded).toHaveLength(95);
    expect(recorded.every(([, status]) => status === "resolved")).toBe(true);
    expect(issuesOf(await archive(team))).toEqual([]);
  }, 60_000);
});

describe("the event", () => {
  it("is the team's own entry when it has no event key", async () => {
    const team = newTeam();
    expect(await jsonAs(team.student, "/archives/defaults")).toEqual({ event: "" });
    expect(await jsonAs(team.student, "/archives/next-match")).toEqual({ nextMatch: "" });
    expect(await archive(team, { type: "practice", event: "Shop" })).toMatchObject({
      event: "Shop",
    });
    expect(await archive(team, { type: "practice" })).toMatchObject({ event: "", details: "" });
  });

  it("is the Blue Alliance key, else the Nexus key, whatever was sent", async () => {
    const team = newTeam();
    const set = (body: Record<string, string>) =>
      jsonAs(team.admin, "/admin/settings", { method: "PATCH", body });

    await set({ nexusEventKey: "2026nexus" });
    expect(await jsonAs(team.student, "/archives/defaults")).toEqual({ event: "2026nexus" });
    // No schedule keys in tests, so there's no next match to offer.
    expect(await jsonAs(team.student, "/archives/next-match")).toEqual({ nextMatch: "" });
    expect(await archive(team, { type: "match", event: "Elsewhere" })).toMatchObject({
      event: "2026nexus",
    });

    await set({ eventKey: "2026tba" });
    expect(await jsonAs(team.student, "/archives/defaults")).toEqual({ event: "2026tba" });
    expect(await archive(team, { type: "match", details: "Qual 12" })).toMatchObject({
      event: "2026tba",
      type: "match",
      details: "Qual 12",
    });
  });
});

describe("the list of archives", () => {
  it("is newest first, a page at a time", async () => {
    const team = newTeam();
    const ids: number[] = [];
    for (let i = 0; i < 52; i++) {
      const made = await jsonAs<Header>(
        team.student,
        "/archives",
        { method: "POST", body: { type: "other", details: `Run ${i}` } },
        201,
      );
      ids.push(made.id);
    }
    const newest = [...ids].reverse();
    const first = await jsonAs<{ archives: Header[]; more: boolean }>(team.student, "/archives");
    expect(first.more).toBe(true);
    expect(first.archives.map((a) => a.id)).toEqual(newest.slice(0, 50));
    const rest = await jsonAs<{ archives: Header[]; more: boolean }>(
      team.student,
      `/archives?before=${first.archives[49].id}`,
    );
    expect(rest.more).toBe(false);
    expect(rest.archives.map((a) => a.id)).toEqual(newest.slice(50));
  }, 60_000);
});

describe("the next official match", () => {
  it("reads a Blue Alliance match key", () => {
    expect(tbaMatchLabel("2026gadal_qm42")).toBe("Qual 42");
    expect(tbaMatchLabel("2026gadal_sf5m1")).toBe("Playoff 5");
    expect(tbaMatchLabel("2026gadal_f1m2")).toBe("Final 2");
    expect(tbaMatchLabel("2026gadal_qf2m3")).toBe("Quarterfinal 2-3");
    expect(tbaMatchLabel(null)).toBe("");
    expect(tbaMatchLabel("2026gadal")).toBe("");
  });

  it("is the team's first match in a Nexus schedule that hasn't gone on the field", () => {
    const match = (label: string, status: string, red: string[], blue: string[] = []) => ({
      label,
      status,
      redTeams: red,
      blueTeams: blue,
    });
    const schedule = [
      match("Practice 3", "Queuing soon", ["1648"]),
      match("Qualification 4", "On field", ["1648", "1", "2"]),
      match("Qualification 9", "On deck", ["3", "4", "5"], ["6", "7", "8"]),
      match("Qualification 12", "Queuing soon", ["3", "4", "5"], ["6", "1648", "8"]),
      match("Qualification 20", "Queuing soon", ["1648"]),
    ];
    expect(nexusNextMatch(schedule, "1648")).toBe("Qual 12");
    expect(nexusNextMatch(schedule, "9999")).toBe("");
    expect(nexusNextMatch([match("Playoff 5", "Now queuing", [], ["1648"])], "1648")).toBe(
      "Playoff 5",
    );
    expect(nexusNextMatch([{ label: "Final 1", status: "On deck", redTeams: null }], "1648")).toBe(
      "",
    );
    expect(nexusNextMatch(undefined, "1648")).toBe("");
  });
});
