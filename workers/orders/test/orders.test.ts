import { admin, kioskAdmin, mentor, otherStudent, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// G3 Orders: anyone requests parts, mentors (and site admins, never kiosk PIN sessions) approve.

type Request = { id: number; status: string; requesterId: string };

async function newCategory(name: string) {
  return jsonAs<{ id: number }>(mentor, "/categories", { method: "POST", body: { name } }, 201);
}

async function newRequest(categoryId: number, title = "WCP 1/2in Hex Bearing", by = student) {
  return jsonAs<Request>(
    by,
    "/requests",
    {
      method: "POST",
      body: {
        url: `https://wcproducts.com/products/${crypto.randomUUID()}`,
        title,
        quantity: 2,
        unitPriceCents: 450,
        categoryId,
        reason: "For the intake",
        catalogCategory: "Bearings & Bushings",
      },
    },
    201,
  );
}

describe("sign-in and roles", () => {
  it("needs a G3ID session", async () => {
    expect((await call("/me")).status).toBe(401);
    expect((await call("/requests")).status).toBe(401);
  });

  it("reports mentor access: mentors and admins, never PIN sessions", async () => {
    expect(await jsonAs(student, "/me")).toMatchObject({ isMentor: false, canEditCatalog: false });
    expect(await jsonAs(mentor, "/me")).toMatchObject({ isMentor: true, canEditCatalog: true });
    expect(await jsonAs(admin, "/me")).toMatchObject({ isMentor: true });
    expect(await jsonAs(kioskAdmin, "/me")).toMatchObject({ isMentor: false });
  });

  it("keeps budget categories to mentors", async () => {
    const create = (user: typeof student) =>
      callAs(user, "/categories", { method: "POST", body: { name: `Cat ${user.id}` } });
    expect((await create(student)).status).toBe(403);
    expect((await create(kioskAdmin)).status).toBe(403);
    expect((await create(mentor)).status).toBe(201);
  });
});

describe("requests", () => {
  it("goes from requested to approved to received", async () => {
    const { id: categoryId } = await newCategory("Mechanical");
    const request = await newRequest(categoryId);
    expect(request).toMatchObject({ status: "requested", requesterId: student.id });

    expect(
      (await callAs(student, `/requests/${request.id}/approve`, { method: "POST", body: {} }))
        .status,
    ).toBe(403);
    expect(
      (await callAs(kioskAdmin, `/requests/${request.id}/approve`, { method: "POST", body: {} }))
        .status,
    ).toBe(403);
    const approved = await jsonAs<Request>(mentor, `/requests/${request.id}/approve`, {
      method: "POST",
      body: {},
    });
    expect(approved.status).toBe("approved");

    // Approving twice is a conflict, not a second approval.
    expect(
      (await callAs(mentor, `/requests/${request.id}/approve`, { method: "POST", body: {} }))
        .status,
    ).toBe(409);

    const detail = await jsonAs<{ events: { action: string }[] }>(
      student,
      `/requests/${request.id}`,
    );
    expect(detail.events.map((e) => e.action)).toEqual(["created", "approved"]);
  });

  it("lets only the requester or a mentor cancel", async () => {
    const { id: categoryId } = await newCategory("Electrical");
    const request = await newRequest(categoryId);
    expect(
      (await callAs(otherStudent, `/requests/${request.id}/cancel`, { method: "POST", body: {} }))
        .status,
    ).toBe(403);
    expect(
      (await callAs(student, `/requests/${request.id}/cancel`, { method: "POST", body: {} }))
        .status,
    ).toBe(200);
  });

  it("filters to your own requests", async () => {
    const { id: categoryId } = await newCategory("Tools");
    await newRequest(categoryId, "Mine");
    await newRequest(categoryId, "Theirs", otherStudent);
    const mine = await jsonAs<{ title: string }[]>(student, "/requests?mine=true");
    expect(mine.map((r) => r.title)).toContain("Mine");
    expect(mine.map((r) => r.title)).not.toContain("Theirs");
  });

  it("rejects incomplete requests", async () => {
    const res = await callAs(student, "/requests", { method: "POST", body: { title: "No link" } });
    expect(res.status).toBe(400);
  });
});

describe("lists", () => {
  it("tracks how far a list's parts are", async () => {
    const { id: categoryId } = await newCategory("Drivetrain");
    const list = await jsonAs<{ id: number }>(
      student,
      "/lists",
      { method: "POST", body: { name: "Intake v2" } },
      201,
    );
    const a = await newRequest(categoryId, "Part A");
    const b = await newRequest(categoryId, "Part B");
    await jsonAs(student, `/lists/${list.id}/items`, {
      method: "POST",
      body: { requestIds: [a.id, b.id] },
    });
    await jsonAs(mentor, `/requests/${a.id}/approve`, { method: "POST", body: {} });

    const detail = await jsonAs<{ progress: Record<string, number> }>(student, `/lists/${list.id}`);
    expect(detail.progress).toMatchObject({ total: 2, active: 2, requested: 1, approved: 1 });
  });

  it("lets only the creator or a mentor delete a list", async () => {
    const list = await jsonAs<{ id: number }>(
      student,
      "/lists",
      { method: "POST", body: { name: "Mine" } },
      201,
    );
    expect((await callAs(otherStudent, `/lists/${list.id}`, { method: "DELETE" })).status).toBe(
      403,
    );
    expect((await callAs(mentor, `/lists/${list.id}`, { method: "DELETE" })).status).toBe(200);
  });
});

describe("part lookup", () => {
  it("reports the shop's edge box being offline", async () => {
    const res = await callAs(
      student,
      `/lookup?url=${encodeURIComponent("https://wcproducts.com/products/x")}`,
    );
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
