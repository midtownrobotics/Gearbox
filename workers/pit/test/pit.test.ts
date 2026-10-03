import { admin, kioskAdmin, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// G3 Pit: checklists and batteries for anyone signed in; event settings for admins.

type Item = { id: number; checked: boolean; index: number };

describe("sign-in and roles", () => {
  it("needs a G3ID session", async () => {
    expect((await call("/me")).status).toBe(401);
    expect((await call("/lists")).status).toBe(401);
    expect(await jsonAs(student, "/me")).toMatchObject({ id: student.id, isAdmin: false });
  });

  it("keeps event settings to admins, never kiosk PIN sessions", async () => {
    expect((await callAs(student, "/admin/settings")).status).toBe(403);
    expect((await callAs(kioskAdmin, "/admin/settings")).status).toBe(403);
    const patch = await callAs(admin, "/admin/settings", {
      method: "PATCH",
      body: { eventKey: "2026test" },
    });
    expect(patch.status).toBe(200);
    expect(await jsonAs(admin, "/admin/settings")).toMatchObject({ eventKey: "2026test" });
  });
});

describe("checklists", () => {
  it("builds a list, checks items and resets it", async () => {
    const list = await jsonAs<{ id: number }>(
      student,
      "/lists",
      {
        method: "POST",
        body: { name: "Pre-match" },
      },
      201,
    );
    const add = (name: string) =>
      jsonAs<Item>(student, `/lists/${list.id}/items`, { method: "POST", body: { name } }, 201);
    const bumpers = await add("Bumpers on");
    const battery = await add("Battery strapped");
    expect([bumpers.index, battery.index]).toEqual([0, 1]);

    const checked = await jsonAs<Item>(student, `/lists/${list.id}/items/${bumpers.id}/checked`, {
      method: "PATCH",
      body: { checked: true },
    });
    expect(checked.checked).toBe(true);

    await jsonAs(student, `/lists/${list.id}/reset`, { method: "POST" });
    const items = await jsonAs<Item[]>(student, `/lists/${list.id}/items`);
    expect(items.every((i) => !i.checked)).toBe(true);
  });

  it("validates input and missing lists", async () => {
    expect((await callAs(student, "/lists", { method: "POST", body: { name: " " } })).status).toBe(
      400,
    );
    expect(
      (await callAs(student, "/lists/9999/items", { method: "POST", body: { name: "x" } })).status,
    ).toBe(404);
  });
});

describe("batteries", () => {
  it("counts a use each time a battery goes into the robot", async () => {
    const battery = await jsonAs<{ id: number }>(
      student,
      "/batteries",
      {
        method: "POST",
        body: { name: "B1" },
      },
      201,
    );
    const setState = (state: string) =>
      jsonAs<{ state: string; useCount: number }>(student, `/batteries/${battery.id}/state`, {
        method: "PATCH",
        body: { state },
      });
    expect(await setState("In Robot")).toMatchObject({ state: "In Robot", useCount: 1 });
    expect(await setState("In Robot")).toMatchObject({ useCount: 1 });
    await setState("Charging");
    expect(await setState("In Robot")).toMatchObject({ useCount: 2 });
    expect(
      (
        await callAs(student, `/batteries/${battery.id}/state`, {
          method: "PATCH",
          body: { state: "Lost" },
        })
      ).status,
    ).toBe(400);
  });
});
