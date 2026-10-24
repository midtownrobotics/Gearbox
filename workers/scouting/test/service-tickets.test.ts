import { env } from "cloudflare:workers";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { describeServiceIssue } from "../src/service-issues";
import type { AppEnv } from "../src/types";

const bindings = env as unknown as AppEnv["Bindings"];

type Ticket = { id: string; team_name: string; issueTypes: string[] } & Record<string, unknown>;

async function crew() {
  const team = teamUsers(newTeamId());
  await jsonAs(
    team.admin,
    "/scouting/service-helpers",
    { method: "POST", body: { userId: team.mentor.id, skills: [] } },
    201,
  );
  return team;
}

const open = (team: ReturnType<typeof teamUsers>, body: Record<string, unknown>) =>
  callAs(team.student, "/scouting/service-tickets", {
    method: "POST",
    body: { teamName: "123", description: "Drive won't turn", ...body },
  });

async function tickets(team: ReturnType<typeof teamUsers>) {
  return (await jsonAs<{ tickets: Ticket[] }>(team.admin, "/scouting/operations")).tickets;
}

async function messages(teamId: string) {
  const response = await bindings.G3ID.fetch(
    new Request(`http://g3id/api/internal/teams/${teamId}/chat/dm-members`),
  );
  return (await response.json()) as { text: string }[];
}

describe("service ticket issue types", () => {
  it("takes several types and returns them in the list's order", async () => {
    const team = await crew();
    expect((await open(team, { issueTypes: ["electrical", "mechanical"] })).status).toBe(201);
    const [ticket] = await tickets(team);
    expect(ticket.issueTypes).toEqual(["mechanical", "electrical"]);
    expect(ticket).not.toHaveProperty("issue_types");
    expect(ticket).not.toHaveProperty("issue_type");
    expect(ticket).not.toHaveProperty("issueType");
    expect((await messages(team.teamId))[0].text).toContain(
      "team 123 has a mechanical and electrical issue.",
    );
  });

  it("takes an empty list when the reporter isn't sure", async () => {
    const team = await crew();
    expect((await open(team, { issueTypes: [] })).status).toBe(201);
    const [ticket] = await tickets(team);
    expect(ticket.issueTypes).toEqual([]);
    expect((await messages(team.teamId))[0].text).toContain(
      "team 123 has an issue (type not sure).",
    );
  });

  it("refuses unknown, repeated or missing types with a clear message", async () => {
    const team = await crew();
    for (const [issueTypes, error] of [
      [["wheels"], 'Unknown issue type "wheels"'],
      [[1], "Unknown issue type 1"],
      [["mechanical", "mechanical"], 'The issue type "mechanical" is listed more than once.'],
      ["mechanical", "issueTypes must be a list"],
      [undefined, "issueTypes must be a list"],
    ] as const) {
      const response = await open(team, { issueTypes });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain(error);
    }
    // The old single field is gone, not read as a fallback.
    expect((await open(team, { issueType: "mechanical" })).status).toBe(400);
    expect(await tickets(team)).toEqual([]);
    expect(await messages(team.teamId)).toEqual([]);
  });

  it("keeps the database to distinct known types", async () => {
    const insert = (issueTypes: string) =>
      bindings.SCOUTING_DB.prepare(
        "INSERT INTO service_tickets (team_id, id, team_name, issue_types, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, '123', ?, 'test', 'Test', 1, 1)",
      )
        .bind(newTeamId(), crypto.randomUUID(), issueTypes)
        .run();
    await expect(insert('["programming","other"]')).resolves.toBeTruthy();
    await expect(insert("[]")).resolves.toBeTruthy();
    for (const bad of [
      "mechanical",
      '{"type":"mechanical"}',
      '["wheels"]',
      '["other","other"]',
      "[1]",
    ])
      await expect(insert(bad)).rejects.toThrow();
  });

  it("names any number of types in a sentence", () => {
    expect(describeServiceIssue([])).toBe("an issue (type not sure)");
    expect(describeServiceIssue(["mechanical"])).toBe("a mechanical issue");
    expect(describeServiceIssue(["electrical"])).toBe("an electrical issue");
    expect(describeServiceIssue(["other"])).toBe("an issue of another kind");
    expect(describeServiceIssue(["electrical", "mechanical"])).toBe(
      "a mechanical and electrical issue",
    );
    expect(describeServiceIssue(["other", "programming", "electrical"])).toBe(
      "an electrical, programming and other issue",
    );
  });
});
