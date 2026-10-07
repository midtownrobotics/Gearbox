import { type TestUser, admin, kioskAdmin, mentor, otherStudent, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// Skill Tree: the students are G3ID's accounts that aren't mentors; everyone signed in sees the
// trees and the team's progress; G3ID mentors and admins (never a kiosk PIN session) sign skills
// off and edit the trees, one piece at a time or by loading a whole set from a file.
//
// The tests share one database and run in order. The last one swaps the whole tree set.

// Accounts only G3ID knows (vitest.config.mts): none of them ever opens Skill Tree.
const QUIET_MENTOR = "mentor-quiet";
const NEW_STUDENT = "student-new";
const BULK_STUDENT = "student-bulk";

type Skill = { id: number; name: string; summary: string; requires: number[] };
type Category = { id: number; name: string; requires: number[]; skills: Skill[] };
type Tree = { id: number; name: string; requiresTreeId: number | null; categories: Category[] };
type Student = { userId: string; name: string; progress: Record<string, string> };
type Loaded = { set: { name: string; loadedByName: string | null }; trees: Tree[] };

type FileSkill = {
  key: string;
  name: string;
  summary?: string;
  description?: string;
  requires?: string[];
};
type FileCategory = { key: string; name: string; requires?: string[]; skills?: FileSkill[] };
type FileTree = {
  key: string;
  name: string;
  icon?: string;
  requires?: string | null;
  categories?: FileCategory[];
};
type TreeFile = { format: string; version: number; name?: string; trees: FileTree[] };
type Change = { total: number; added: number; removed: number };
type LoadResult = {
  summary: { trees: Change; categories: Change; skills: Change; progressRemoved: number };
};

const loadTrees = async () => (await jsonAs<Loaded>(student, "/trees")).trees;
const loadStudents = async () =>
  (await jsonAs<{ students: Student[] }>(student, "/students")).students;
const studentIds = async () => (await loadStudents()).map((s) => s.userId);
const progressOf = async (userId: string) =>
  (await loadStudents()).find((s) => s.userId === userId)?.progress ?? {};
const safety = async () => (await loadTrees()).find((t) => t.name === "Safety") as Tree;

const mark = (by: TestUser, userId: string, skillId: number, status: string) =>
  callAs(by, `/students/${userId}/skills/${skillId}`, { method: "PUT", body: { status } });

const exportFile = () => jsonAs<TreeFile>(mentor, "/trees/export");
const loadFile = (file: unknown, by = mentor) =>
  callAs(by, "/trees/import", { method: "POST", body: file });
const previewFile = (file: unknown, by = mentor) =>
  callAs(by, "/trees/import/preview", { method: "POST", body: file });

/** A tree of the test's own, so tests don't trip over each other's edits. */
async function newTree(name: string) {
  const { id } = await jsonAs<{ id: number }>(
    mentor,
    "/trees",
    { method: "POST", body: { name, icon: "🧪" } },
    201,
  );
  const category = await jsonAs<{ id: number }>(
    mentor,
    `/trees/${id}/categories`,
    { method: "POST", body: { name: "Basics" } },
    201,
  );
  const skill = (skillName: string, requires: number[] = []) =>
    jsonAs<{ id: number }>(
      mentor,
      `/categories/${category.id}/skills`,
      { method: "POST", body: { name: skillName, requires } },
      201,
    );
  return { id, categoryId: category.id, skill };
}

describe("the list of students", () => {
  it("is the team's active members, less its mentors", async () => {
    // Roles come with the member list, so a mentor who never opens Skill Tree is left out too.
    // An admin who isn't a mentor is a student.
    const ids = await studentIds();
    expect(ids).not.toContain(mentor.id);
    expect(ids).not.toContain(QUIET_MENTOR);
    expect(ids).toEqual(
      expect.arrayContaining([student.id, otherStudent.id, NEW_STUDENT, BULK_STUDENT, admin.id]),
    );
  });

  it("is in name order, with names from G3ID", async () => {
    const names = (await loadStudents()).map((s) => s.name);
    expect(names).toContain("Nia Newcomer");
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("sign-in and roles", () => {
  it("needs a G3ID session", async () => {
    expect((await call("/me")).status).toBe(401);
    expect((await call("/trees")).status).toBe(401);
    expect((await call("/students")).status).toBe(401);
  });

  it("reports mentor access: mentors and admins, never PIN sessions", async () => {
    expect(await jsonAs(student, "/me")).toMatchObject({ userId: student.id, isMentor: false });
    expect(await jsonAs(mentor, "/me")).toMatchObject({ isMentor: true });
    expect(await jsonAs(admin, "/me")).toMatchObject({ isMentor: true });
    expect(await jsonAs(kioskAdmin, "/me")).toMatchObject({ isMentor: false });
  });
});

describe("the default trees", () => {
  it("are what a team starts with, with Safety opening the others", async () => {
    const { set, trees } = await jsonAs<Loaded>(student, "/trees");
    expect(set).toEqual({
      name: "Default skill trees",
      loadedByName: null,
      loadedAt: expect.any(Number),
    });
    expect(trees).toHaveLength(9);
    const safetyTree = trees.find((t) => t.name === "Safety");
    const manufacturing = trees.find((t) => t.name === "Manufacturing");
    expect(safetyTree?.requiresTreeId).toBeNull();
    expect(manufacturing?.requiresTreeId).toBe(safetyTree?.id);
    expect(safetyTree?.categories.map((c) => c.name)).toEqual([
      "Shop Safety",
      "Battery & Electrical",
      "Robot Operation",
    ]);
    const [shop, battery] = safetyTree?.categories ?? [];
    expect(battery.requires).toEqual([shop.id]);
    expect(shop.skills[1].requires).toEqual([shop.skills[0].id]);
    expect(trees.flatMap((t) => t.categories.flatMap((c) => c.skills))).toHaveLength(224);
  });
});

describe("progress", () => {
  it("lets mentors and admins sign a skill off, and records who did", async () => {
    const [first, second] = (await safety()).categories[0].skills;
    expect((await mark(mentor, student.id, first.id, "complete")).status).toBe(200);
    expect((await mark(admin, student.id, second.id, "in-progress")).status).toBe(200);
    expect(await progressOf(student.id)).toMatchObject({
      [first.id]: "complete",
      [second.id]: "in-progress",
    });

    const detail = await jsonAs<{
      name: string;
      progress: { skillId: number; status: string; updatedByName: string; updatedAt: number }[];
    }>(otherStudent, `/students/${student.id}`);
    expect(detail.name).toBe(student.displayName);
    expect(detail.progress.find((p) => p.skillId === first.id)).toMatchObject({
      status: "complete",
      updatedByName: mentor.displayName,
    });
  });

  it("clears a skill set back to not started", async () => {
    const skill = (await safety()).categories[1].skills[0];
    await mark(mentor, student.id, skill.id, "complete");
    expect((await mark(mentor, student.id, skill.id, "not-started")).status).toBe(200);
    expect((await progressOf(student.id))[skill.id]).toBeUndefined();
  });

  it("keeps sign-offs from students and kiosk sessions", async () => {
    const skill = (await safety()).categories[0].skills[0];
    expect((await mark(student, otherStudent.id, skill.id, "complete")).status).toBe(403);
    expect((await mark(student, student.id, skill.id, "complete")).status).toBe(403);
    expect((await mark(kioskAdmin, student.id, skill.id, "complete")).status).toBe(403);
  });

  it("rejects unknown statuses and skills", async () => {
    const skill = (await safety()).categories[0].skills[0];
    expect((await mark(mentor, student.id, skill.id, "done-ish")).status).toBe(400);
    expect((await mark(mentor, student.id, 999_999, "complete")).status).toBe(404);
  });

  it("is only for students: any of G3ID's, but not mentors or strangers", async () => {
    const skill = (await safety()).categories[0].skills[0];
    // Someone who has never opened Skill Tree.
    expect((await mark(mentor, NEW_STUDENT, skill.id, "complete")).status).toBe(200);
    expect(await progressOf(NEW_STUDENT)).toEqual({ [skill.id]: "complete" });

    expect((await mark(mentor, "ghost-1", skill.id, "complete")).status).toBe(404);
    expect((await mark(admin, mentor.id, skill.id, "complete")).status).toBe(404);
    expect((await callAs(student, "/students/ghost-1")).status).toBe(404);
    expect((await callAs(student, `/students/${mentor.id}`)).status).toBe(404);
    expect((await call(`/students/${student.id}`)).status).toBe(401);
  });
});

describe("bulk sign-off", () => {
  it("sets one status for several people on several skills", async () => {
    const skillIds = (await safety()).categories[2].skills.map((s) => s.id);
    const body = { userIds: [student.id, BULK_STUDENT], skillIds, status: "complete" };
    expect(await jsonAs(mentor, "/progress", { method: "POST", body })).toEqual({
      updated: 2 * skillIds.length,
    });
    for (const userId of body.userIds) {
      const progress = await progressOf(userId);
      expect(skillIds.every((id) => progress[id] === "complete")).toBe(true);
    }

    await jsonAs(mentor, "/progress", { method: "POST", body: { ...body, status: "not-started" } });
    const cleared = await progressOf(BULK_STUDENT);
    expect(skillIds.some((id) => id in cleared)).toBe(false);
  });

  it("is for mentors, with real students and skills", async () => {
    const skillIds = [(await safety()).categories[0].skills[0].id];
    const post = (by: TestUser, body: unknown) => callAs(by, "/progress", { method: "POST", body });
    const body = { userIds: [student.id], skillIds, status: "complete" };
    expect((await post(student, body)).status).toBe(403);
    expect((await post(kioskAdmin, body)).status).toBe(403);
    expect((await post(mentor, { ...body, skillIds: [999_999] })).status).toBe(400);
    expect((await post(mentor, { ...body, userIds: [student.id, "ghost-2"] })).status).toBe(404);
    expect((await post(mentor, { ...body, userIds: [QUIET_MENTOR] })).status).toBe(404);
    expect((await post(mentor, { ...body, userIds: [] })).status).toBe(400);
  });

  it("finds a student by kiosk PIN, for mentors only", async () => {
    expect(await jsonAs(mentor, "/students/by-pin/123")).toEqual({
      userId: otherStudent.id,
      name: otherStudent.displayName,
    });
    // A mentor's PIN, no one's PIN, and not a PIN.
    expect((await callAs(mentor, "/students/by-pin/777")).status).toBe(404);
    expect((await callAs(mentor, "/students/by-pin/999")).status).toBe(404);
    expect((await callAs(mentor, "/students/by-pin/abc")).status).toBe(400);
    expect((await callAs(student, "/students/by-pin/123")).status).toBe(403);
  });
});

describe("editing trees", () => {
  it("is for mentors and admins, not students or kiosk sessions", async () => {
    const create = (by: TestUser) =>
      callAs(by, "/trees", { method: "POST", body: { name: `Tree by ${by.id}` } });
    expect((await create(student)).status).toBe(403);
    expect((await create(kioskAdmin)).status).toBe(403);
    expect((await create(admin)).status).toBe(201);
    const first = (await loadTrees())[0];
    expect(
      (await callAs(student, `/trees/${first.id}`, { method: "PATCH", body: { name: "Mine" } }))
        .status,
    ).toBe(403);
    expect((await callAs(student, `/trees/${first.id}`, { method: "DELETE" })).status).toBe(403);
  });

  it("builds a tree of categories and skills", async () => {
    const tree = await newTree("Media");
    const camera = await tree.skill("Camera basics");
    const editing = await tree.skill("Editing", [camera.id]);
    await jsonAs(mentor, `/skills/${editing.id}`, {
      method: "PATCH",
      body: { summary: "cuts, color, export", description: "Edit a 60-second recap." },
    });
    const advanced = await jsonAs<{ id: number }>(
      mentor,
      `/trees/${tree.id}/categories`,
      { method: "POST", body: { name: "Advanced", requires: [tree.categoryId] } },
      201,
    );
    await jsonAs(mentor, `/trees/${tree.id}`, {
      method: "PATCH",
      body: { subtitle: "Photo and video", requiresTreeId: (await safety()).id },
    });

    const saved = (await loadTrees()).find((t) => t.id === tree.id);
    expect(saved).toMatchObject({
      name: "Media",
      subtitle: "Photo and video",
      icon: "🧪",
      requiresTreeId: (await safety()).id,
    });
    expect(saved?.categories.map((c) => [c.name, c.requires])).toEqual([
      ["Basics", []],
      ["Advanced", [tree.categoryId]],
    ]);
    expect(saved?.categories[0].skills).toMatchObject([
      { name: "Camera basics", requires: [] },
      { name: "Editing", summary: "cuts, color, export", requires: [camera.id] },
    ]);
    expect(saved?.categories[1].id).toBe(advanced.id);
  });

  it("rejects prerequisites that loop or cross categories", async () => {
    const tree = await newTree("Loops");
    const a = await tree.skill("A");
    const b = await tree.skill("B", [a.id]);
    const c = await tree.skill("C", [b.id]);
    const requires = (id: number, ids: number[], path = "skills") =>
      callAs(mentor, `/${path}/${id}`, { method: "PATCH", body: { requires: ids } });
    expect((await requires(a.id, [a.id])).status).toBe(400);
    expect((await requires(a.id, [c.id])).status).toBe(400);
    expect((await requires(c.id, [a.id, b.id])).status).toBe(200);

    const elsewhere = (await safety()).categories[0].skills[0];
    expect((await requires(a.id, [elsewhere.id])).status).toBe(400);

    const second = await jsonAs<{ id: number }>(
      mentor,
      `/trees/${tree.id}/categories`,
      { method: "POST", body: { name: "Second", requires: [tree.categoryId] } },
      201,
    );
    expect((await requires(tree.categoryId, [second.id], "categories")).status).toBe(400);
    expect(
      (await requires(tree.categoryId, [(await safety()).categories[0].id], "categories")).status,
    ).toBe(400);

    // Trees can't gate each other in a circle either.
    const other = await newTree("Loops 2");
    const gate = (id: number, requiresTreeId: number) =>
      callAs(mentor, `/trees/${id}`, { method: "PATCH", body: { requiresTreeId } });
    expect((await gate(other.id, tree.id)).status).toBe(200);
    expect((await gate(tree.id, other.id)).status).toBe(400);
    expect((await gate(tree.id, tree.id)).status).toBe(400);
  });

  it("deletes a skill, category or tree along with the progress on it", async () => {
    const tree = await newTree("Temporary");
    const keep = await tree.skill("Keep");
    const drop = await tree.skill("Drop", [keep.id]);
    await mark(mentor, student.id, keep.id, "complete");
    await mark(mentor, student.id, drop.id, "complete");

    expect((await callAs(mentor, `/skills/${drop.id}`, { method: "DELETE" })).status).toBe(200);
    let progress = await progressOf(student.id);
    expect(progress[keep.id]).toBe("complete");
    expect(progress[drop.id]).toBeUndefined();

    expect((await callAs(mentor, `/trees/${tree.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await loadTrees()).some((t) => t.id === tree.id)).toBe(false);
    progress = await progressOf(student.id);
    expect(progress[keep.id]).toBeUndefined();
    expect((await callAs(mentor, `/trees/${tree.id}`, { method: "DELETE" })).status).toBe(404);
    expect(
      (await callAs(mentor, `/categories/${tree.categoryId}`, { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("reorders trees", async () => {
    const tree = await newTree("Goes first");
    const ids = (await loadTrees()).map((t) => t.id);
    const order = [tree.id, ...ids.filter((id) => id !== tree.id)];
    const put = (body: unknown) => callAs(mentor, "/trees/order", { method: "PUT", body });
    expect((await put({ ids: order.slice(1) })).status).toBe(400);
    expect((await put({ ids: order })).status).toBe(200);
    expect((await loadTrees()).map((t) => t.id)).toEqual(order);
  });

  it("checks names", async () => {
    const post = (body: unknown) => callAs(mentor, "/trees", { method: "POST", body });
    expect((await post({ name: "  " })).status).toBe(400);
    expect((await post({ name: "x".repeat(61) })).status).toBe(400);
    expect((await post({ name: "Fine", requiresTreeId: 999_999 })).status).toBe(400);
  });
});

describe("tree sets", () => {
  const unchanged = { added: 0, removed: 0 };

  it("saves the trees to a file that loads back without changing anything", async () => {
    const file = await exportFile();
    expect(file).toMatchObject({ format: "gearbox-skill-trees", version: 1 });
    expect(file.trees.find((t) => t.key === "manufacturing")).toMatchObject({
      name: "Manufacturing",
      requires: "safety",
    });

    const preview = (await (await previewFile(file)).json()) as LoadResult;
    expect(preview).toMatchObject({
      summary: { trees: unchanged, categories: unchanged, skills: unchanged, progressRemoved: 0 },
    });

    const before = await loadTrees();
    expect((await loadFile(file)).status).toBe(200);
    expect(await loadTrees()).toEqual(before);
  });

  it("names what's made in the app so a file can tell it apart", async () => {
    const one = await newTree("Twins");
    const two = await newTree("Twins");
    await one.skill("Same name");
    await two.skill("Same name");
    const twins = (await exportFile()).trees.filter((t) => t.name === "Twins");
    expect(twins.map((t) => t.key)).toEqual(["twins", "twins-2"]);
    expect(twins.map((t) => t.categories?.[0].skills?.[0].key)).toEqual([
      "same-name",
      "same-name-2",
    ]);
  });

  it("keeps progress on what a loaded file still has, and says what it would delete", async () => {
    const tree = await newTree("Loadable");
    const keep = await tree.skill("Keep me");
    const drop = await tree.skill("Drop me", [keep.id]);
    await mark(mentor, student.id, keep.id, "complete");
    await mark(mentor, student.id, drop.id, "complete");

    // Edit the saved file: rename one skill and move it to a new category, drop the other, and
    // add a new one.
    const file = await exportFile();
    const mine = file.trees.find((t) => t.key === "loadable") as FileTree;
    const [kept] = mine.categories?.[0].skills ?? [];
    expect(kept.key).toBe("keep-me");
    mine.categories = [
      { key: "basics", name: "Basics", skills: [{ key: "brand-new", name: "Brand new" }] },
      {
        key: "moved",
        name: "Moved here",
        requires: ["basics"],
        skills: [{ ...kept, name: "Kept, renamed" }],
      },
    ];

    const preview = (await (await previewFile(file)).json()) as LoadResult;
    expect(preview.summary).toMatchObject({
      trees: unchanged,
      categories: { added: 1, removed: 0 },
      skills: { added: 1, removed: 1 },
      progressRemoved: 1,
    });
    // A preview changes nothing.
    expect((await progressOf(student.id))[drop.id]).toBe("complete");

    const applied = await jsonAs<LoadResult>(mentor, "/trees/import", {
      method: "POST",
      body: file,
    });
    expect(applied).toEqual(preview);

    const { set, trees } = await jsonAs<Loaded>(student, "/trees");
    expect(set.loadedByName).toBe(mentor.displayName);
    const saved = trees.find((t) => t.id === tree.id);
    expect(saved?.categories.map((c) => c.name)).toEqual(["Basics", "Moved here"]);
    expect(saved?.categories[0].skills.map((s) => s.name)).toEqual(["Brand new"]);
    expect(saved?.categories[1].requires).toEqual([saved?.categories[0].id]);
    expect(saved?.categories[1].skills).toMatchObject([{ id: keep.id, name: "Kept, renamed" }]);

    const progress = await progressOf(student.id);
    expect(progress[keep.id]).toBe("complete");
    expect(progress[drop.id]).toBeUndefined();
  });

  it("refuses a file that doesn't hold together, and changes nothing", async () => {
    const file = await exportFile();
    const before = await loadTrees();
    const problemsWith = async (change: (copy: TreeFile) => void) => {
      const copy = structuredClone(file);
      change(copy);
      const res = await loadFile(copy);
      expect(res.status).toBe(400);
      return ((await res.json()) as { problems: string[] }).problems.join("\n");
    };
    // Other tests have added and moved trees, so these go by key.
    const tree = (copy: TreeFile, key: string) => copy.trees.find((t) => t.key === key) as FileTree;
    const firstSkill = (copy: TreeFile, key = "safety") =>
      tree(copy, key).categories?.[0].skills?.[0] as FileSkill;

    expect((await loadFile({ trees: file.trees })).status).toBe(400);
    expect(await problemsWith((copy) => Object.assign(copy, { version: 2 }))).toContain(
      "Only version 1",
    );
    expect(await problemsWith((copy) => Object.assign(copy, { trees: [] }))).toContain("no trees");
    expect(
      await problemsWith((copy) => {
        firstSkill(copy, "manufacturing").key = firstSkill(copy).key;
      }),
    ).toContain("another skill in the file has the key");
    expect(
      await problemsWith((copy) => {
        firstSkill(copy).requires = ["not-a-skill"];
      }),
    ).toContain(`requires "not-a-skill", which isn't in its category`);
    expect(
      await problemsWith((copy) => {
        const [a, b] = tree(copy, "safety").categories?.[0].skills ?? [];
        a.requires = [b.key];
        b.requires = [a.key];
      }),
    ).toContain("requires itself through");
    expect(
      await problemsWith((copy) => {
        tree(copy, "safety").requires = "safety";
      }),
    ).toContain("can't require itself");
    expect(
      await problemsWith((copy) => {
        firstSkill(copy).name = "";
        tree(copy, "electrical").key = "no spaces allowed";
      }),
    ).toMatch(/name is empty[\s\S]*"key" must be/);

    expect(await loadTrees()).toEqual(before);
  });

  it("is for mentors", async () => {
    const file = await exportFile();
    for (const user of [student, kioskAdmin]) {
      expect((await callAs(user, "/trees/export")).status).toBe(403);
      expect((await callAs(user, "/trees/default")).status).toBe(403);
      expect((await loadFile(file, user)).status).toBe(403);
      expect((await previewFile(file, user)).status).toBe(403);
    }
  });

  it("swaps the whole set for a team's own, and can go back to the default", async () => {
    const marked = Object.keys(await progressOf(student.id)).length;
    expect(marked).toBeGreaterThan(0);
    const own: TreeFile = {
      format: "gearbox-skill-trees",
      version: 1,
      name: "Team 9999's trees",
      trees: [
        {
          key: "welding",
          name: "Welding",
          icon: "🔥",
          categories: [
            {
              key: "start",
              name: "Getting started",
              skills: [
                { key: "W1", name: "Strike an arc" },
                { key: "W2", name: "Run a bead", requires: ["W1"] },
              ],
            },
          ],
        },
        { key: "paint", name: "Paint", requires: "welding" },
      ],
    };

    const loaded = await jsonAs<LoadResult>(mentor, "/trees/import", { method: "POST", body: own });
    expect(loaded.summary.trees).toMatchObject({ total: 2, added: 2 });
    expect(loaded.summary.skills).toMatchObject({ total: 2, added: 2 });
    expect(loaded.summary.progressRemoved).toBeGreaterThanOrEqual(marked);

    const { set, trees } = await jsonAs<Loaded>(student, "/trees");
    expect(set.name).toBe("Team 9999's trees");
    expect(trees.map((t) => t.name)).toEqual(["Welding", "Paint"]);
    expect(trees[1].requiresTreeId).toBe(trees[0].id);
    const [arc, bead] = trees[0].categories[0].skills;
    expect(bead.requires).toEqual([arc.id]);
    expect(await progressOf(student.id)).toEqual({});

    // Everything still works on a set the app has never seen.
    expect((await mark(mentor, student.id, arc.id, "complete")).status).toBe(200);
    expect(await exportFile()).toMatchObject({ name: "Team 9999's trees" });

    const starter = await jsonAs<TreeFile>(mentor, "/trees/default");
    expect((await loadFile(starter)).status).toBe(200);
    const back = await jsonAs<Loaded>(student, "/trees");
    expect(back.set.name).toBe("Default skill trees");
    expect(back.trees).toHaveLength(9);
    expect(await progressOf(student.id)).toEqual({});
  });
});
