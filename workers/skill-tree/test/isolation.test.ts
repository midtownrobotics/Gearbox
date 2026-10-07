import { env } from "cloudflare:test";
import { type Seeded, checkIsolation } from "@g3/testing/isolation";
import type { TeamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { expect, it } from "vitest";
import { app } from "../src/index";

// Two teams, each with its own trees and progress. Every route, called as team A's admin, mentor,
// student and kiosk session with team B's ids, must show none of B's and change nothing of B's.

const db = (env as unknown as { SKILL_DB: D1Database }).SKILL_DB;

type Tree = { id: number; categories: { id: number; skills: { id: number }[] }[] };

async function seed(team: TeamUsers): Promise<Seeded> {
  const tag = `${team.teamId}-${crypto.randomUUID().slice(0, 8)}`;
  const file = {
    format: "gearbox-skill-trees",
    version: 1,
    name: `Set ${tag}`,
    trees: [
      {
        key: "only",
        name: `Tree ${tag}`,
        icon: "🌲",
        requires: null,
        categories: [
          {
            key: "cat",
            name: `Category ${tag}`,
            skills: [{ key: "skill", name: `Skill ${tag}`, summary: `Summary ${tag}` }],
          },
        ],
      },
    ],
  };
  const loaded = await callAs(team.mentor, "/trees/import", { method: "POST", body: file });
  expect(loaded.status).toBe(200);
  const { trees } = await jsonAs<{ trees: Tree[] }>(team.mentor, "/trees");
  const tree = trees[0];
  const category = tree.categories[0];
  const skill = category.skills[0];
  const signed = await callAs(team.mentor, `/students/${team.student.id}/skills/${skill.id}`, {
    method: "PUT",
    body: { status: "complete" },
  });
  expect(signed.status).toBe(200);

  const ids: Record<string, string> = {
    trees: String(tree.id),
    categories: String(category.id),
    skills: String(skill.id),
  };
  return {
    params: (path, name) => {
      if (name === "userId") return team.student.id;
      if (name === "skillId") return ids.skills;
      if (name === "id") return ids[path.split("/")[1]];
      return undefined;
    },
    markers: [tag],
    data: { tree: tree.id, category: category.id, skill: skill.id, student: team.student.id },
  };
}

/** Everything of the team's: its set and what hangs off it, with the progress on its skills. */
async function snapshot(teamId: string) {
  const set = await db.prepare("SELECT * FROM tree_sets WHERE team_id = ?").bind(teamId).first();
  const rows = async (sql: string) => (await db.prepare(sql).bind(set?.id).all()).results;
  return {
    set,
    trees: await rows("SELECT * FROM trees WHERE tree_set_id = ? ORDER BY id"),
    categories: await rows(
      "SELECT c.* FROM tree_categories c JOIN trees t ON t.id = c.tree_id WHERE t.tree_set_id = ? ORDER BY c.id",
    ),
    skills: await rows("SELECT * FROM skills WHERE tree_set_id = ? ORDER BY id"),
    progress: await rows(
      "SELECT p.* FROM skill_progress p JOIN skills s ON s.id = p.skill_id WHERE s.tree_set_id = ? ORDER BY p.user_id, p.skill_id",
    ),
  };
}

it("keeps every team's trees and progress to itself", async () => {
  const { problems, requests } = await checkIsolation({
    app,
    seed,
    snapshot,
    bodies: (b) => {
      const { tree, category, skill, student } = b.data as Record<string, number | string>;
      return {
        "PATCH /trees/:id": { name: "Renamed" },
        "POST /trees/:id/categories": { name: "New category" },
        "PATCH /categories/:id": { name: "Renamed" },
        "POST /categories/:id/skills": { name: "New skill" },
        "PATCH /skills/:id": { name: "Renamed" },
        "PUT /trees/order": { treeIds: [tree] },
        "PUT /students/:userId/skills/:skillId": { status: "not-started" },
        "POST /progress": { userIds: [student], skillIds: [skill], status: "not-started" },
        "POST /trees": { name: "New tree", requiresTreeId: tree },
        "PATCH /trees/:id/requires": { requires: [category] },
      };
    },
  });
  expect(problems).toEqual([]);
  // Every route was called, as four people.
  expect(requests).toBeGreaterThan(60);
});
