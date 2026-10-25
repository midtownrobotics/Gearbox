import { newTeamId, teamUsers } from "@g3/testing/users";
import { jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

describe("tier list autosave", () => {
  it("retries creation with a stable id without duplicating lists or crossing teams", async () => {
    const a = teamUsers(newTeamId());
    const b = teamUsers(newTeamId());
    const id = crypto.randomUUID();
    const save = (user: typeof a.admin, name: string, items: string[]) =>
      jsonAs(
        user,
        "/scouting/tier-lists",
        {
          method: "POST",
          body: { id, name, tiers: [{ id: "s", name: "S", color: "#ef5350", items }] },
        },
        201,
      );
    await save(a.admin, "First", ["1", "2"]);
    await save(a.admin, "Latest", ["2", "1"]);
    await save(b.admin, "Other team", ["3"]);
    const first = await jsonAs<{
      tierLists: { id: string; name: string; tiers: { items: string[] }[] }[];
    }>(a.admin, "/scouting/tier-lists");
    expect(first.tierLists).toHaveLength(1);
    expect(first.tierLists[0]).toMatchObject({
      id,
      name: "Latest",
      tiers: [{ items: ["2", "1"] }],
    });
    const second = await jsonAs<{ tierLists: { name: string }[] }>(b.admin, "/scouting/tier-lists");
    expect(second.tierLists).toHaveLength(1);
    expect(second.tierLists[0].name).toBe("Other team");
  });
});
