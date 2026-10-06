import { mentor, student } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// Removing a catalog category moves its parts to another one first.

const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;

async function category(name = unique("Cat")) {
  await jsonAs(mentor, "/catalog/categories", { method: "POST", body: { name } }, 201);
  return name;
}

const addPart = (category: string) =>
  jsonAs<{ id: number }>(
    mentor,
    "/catalog/items",
    {
      method: "POST",
      body: {
        name: unique("Part"),
        category,
        vendor: "Amazon",
        sku: null,
        url: `https://example.com/${crypto.randomUUID()}`,
      },
    },
    201,
  );

const remove = (user: typeof mentor, body: unknown) =>
  callAs(user, "/catalog/categories", { method: "DELETE", body });

const categories = () => jsonAs<string[]>(mentor, "/catalog/categories");

describe("removing a catalog category", () => {
  it("moves its parts to another category, then removes it", async () => {
    const from = await category();
    const to = await category();
    const parts = [await addPart(from), await addPart(from)];

    const res = await remove(mentor, { name: from, moveTo: to });
    expect(await res.json()).toEqual({ moved: 2, to });
    expect(await categories()).not.toContain(from);
    const items = await jsonAs<{ id: number; category: string }[]>(
      mentor,
      `/catalog/items?ids=${parts.map((p) => p.id).join(",")}`,
    );
    expect(items.map((i) => i.category)).toEqual([to, to]);
  });

  it("removes an empty category without anywhere to move to", async () => {
    const empty = await category();
    expect((await remove(mentor, { name: empty })).status).toBe(200);
    expect(await categories()).not.toContain(empty);
  });

  it("needs somewhere real, and different, to move the parts", async () => {
    const from = await category();
    await addPart(from);
    expect((await remove(mentor, { name: from })).status).toBe(400);
    expect((await remove(mentor, { name: from, moveTo: from })).status).toBe(400);
    expect((await remove(mentor, { name: from, moveTo: unique("Nowhere") })).status).toBe(400);
    expect((await remove(mentor, { name: unique("Missing"), moveTo: from })).status).toBe(404);
    expect(await categories()).toContain(from);
  });

  it("is for catalog editors only", async () => {
    const empty = await category();
    expect((await remove(student, { name: empty })).status).toBe(403);
    expect(await categories()).toContain(empty);
  });
});
