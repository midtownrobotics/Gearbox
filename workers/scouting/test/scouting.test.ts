import { admin, kioskAdmin, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// G3 Strategy (scouting), served under /scouting. Strategy leads (G3ID admins, or people a G3ID
// admin made a lead) manage forms; anyone signed in scouts and keeps tier lists.

const form = {
  name: "Match scouting",
  fields: [{ id: "auto", label: "Auto points", type: "counter" }],
};

describe("sign-in and roles", () => {
  it("needs a G3ID session (the local auth bypass is off)", async () => {
    expect((await call("/scouting/me")).status).toBe(401);
    expect((await call("/scouting/tier-lists")).status).toBe(401);
  });

  it("reports who's a strategy lead", async () => {
    expect(await jsonAs(student, "/scouting/me")).toMatchObject({
      userId: student.id,
      isAdmin: false,
    });
    expect(await jsonAs(admin, "/scouting/me")).toMatchObject({ isAdmin: true, isG3IdAdmin: true });
    expect(await jsonAs(kioskAdmin, "/scouting/me")).toMatchObject({ isAdmin: false });
  });

  it("keeps scouting forms to strategy leads", async () => {
    const create = (user: typeof student) =>
      callAs(user, "/scouting/scouting-forms", { method: "POST", body: form });
    expect((await create(student)).status).toBe(403);
    expect((await create(kioskAdmin)).status).toBe(403);
    expect((await create(admin)).status).toBe(201);
    const forms = await jsonAs<{ forms: { name: string }[] }>(student, "/scouting/scouting-forms");
    expect(forms.forms.map((f) => f.name)).toContain("Match scouting");
  });

  it("lets only G3ID admins make strategy leads, who can then manage forms", async () => {
    const grant = (user: typeof student) =>
      callAs(user, "/scouting/strategy-admins", { method: "POST", body: { userId: student.id } });
    expect((await grant(student)).status).toBe(403);
    expect((await grant(admin)).status).toBe(201);
    expect(await jsonAs(student, "/scouting/me")).toMatchObject({
      isAdmin: true,
      isG3IdAdmin: false,
    });
    expect(
      (await callAs(student, "/scouting/scouting-forms", { method: "POST", body: form })).status,
    ).toBe(201);
    // A lead can't make more leads.
    expect((await grant(student)).status).toBe(403);
  });

  it("rejects a form without valid fields", async () => {
    const res = await callAs(admin, "/scouting/scouting-forms", {
      method: "POST",
      body: { name: "Empty", fields: [] },
    });
    expect(res.status).toBe(400);
  });
});

describe("tier lists", () => {
  it("creates, updates and deletes one", async () => {
    const { id } = await jsonAs<{ id: string }>(
      student,
      "/scouting/tier-lists",
      { method: "POST", body: { name: "Picks", tiers: [] } },
      201,
    );
    const tiers = [{ id: "s", name: "S", color: "#a32035", items: ["9999"] }];
    await jsonAs(student, `/scouting/tier-lists/${id}`, {
      method: "PUT",
      body: { name: "Picks v2", tiers },
    });
    const lists = await jsonAs<{ tierLists: { id: string; name: string; tiers: unknown }[] }>(
      student,
      "/scouting/tier-lists",
    );
    expect(lists.tierLists.find((l) => l.id === id)).toMatchObject({ name: "Picks v2", tiers });
    await jsonAs(student, `/scouting/tier-lists/${id}`, { method: "DELETE" });
    const after = await jsonAs<{ tierLists: { id: string }[] }>(student, "/scouting/tier-lists");
    expect(after.tierLists.map((l) => l.id)).not.toContain(id);
  });

  it("needs a name", async () => {
    const res = await callAs(student, "/scouting/tier-lists", {
      method: "POST",
      body: { tiers: [] },
    });
    expect(res.status).toBe(400);
  });
});
