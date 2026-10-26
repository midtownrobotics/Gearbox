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

describe("the reason", () => {
  it("is optional: left out or blank, the request is still made", async () => {
    const category = await newCategory(`No reason ${crypto.randomUUID()}`);
    for (const reason of [undefined, "", "  "]) {
      const made = await jsonAs<{ reason: string }>(
        student,
        "/requests",
        {
          method: "POST",
          body: {
            url: `https://wcproducts.com/products/${crypto.randomUUID()}`,
            title: "WCP Shaft Collar",
            quantity: 1,
            categoryId: category.id,
            catalogCategory: "Bearings & Bushings",
            ...(reason === undefined ? {} : { reason }),
          },
        },
        201,
      );
      expect(made.reason).toBe("");
    }
  });
});

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

  it("lets a mentor edit an approved request, which is approved again as changed", async () => {
    const { id: categoryId } = await newCategory(`Reapprove ${crypto.randomUUID()}`);
    const request = await newRequest(categoryId);
    const edit = (user: typeof student, body: Record<string, unknown>) =>
      callAs(user, `/requests/${request.id}`, { method: "PATCH", body });
    await jsonAs(mentor, `/requests/${request.id}/approve`, { method: "POST", body: {} });

    // Once approved it's the mentors' to change: not the requester's, and never a kiosk's.
    expect((await edit(student, { quantity: 9 })).status).toBe(403);
    expect((await edit(otherStudent, { quantity: 9 })).status).toBe(403);
    expect((await edit(kioskAdmin, { quantity: 9 })).status).toBe(403);

    const res = await edit(mentor, { quantity: 5, unitPriceCents: 500 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "approved",
      quantity: 5,
      unitPriceCents: 500,
    });

    const detail = await jsonAs<{ events: { action: string; note: string | null }[] }>(
      student,
      `/requests/${request.id}`,
    );
    expect(detail.events.map((e) => e.action)).toEqual(["created", "approved", "reapproved"]);
    expect(detail.events[2].note).toBe("Changed qty 2 → 5, price $4.50 → $5.00.");

    // Not after it's left the approved pile.
    await jsonAs(mentor, `/requests/${request.id}/cancel`, { method: "POST", body: {} });
    expect((await edit(mentor, { quantity: 6 })).status).toBe(409);
  });

  it("changes the link, and the history keeps what the item was", async () => {
    const { id: categoryId } = await newCategory(`Relink ${crypto.randomUUID()}`);
    const request = await newRequest(categoryId, "Wrong Bearing");
    const url = `https://www.revrobotics.com/${crypto.randomUUID()}/`;
    const edit = (user: typeof student, body: Record<string, unknown>) =>
      callAs(user, `/requests/${request.id}`, { method: "PATCH", body });

    // Someone else's request isn't theirs to relink.
    expect((await edit(otherStudent, { url, catalogCategory: "Bearings & Bushings" })).status).toBe(
      403,
    );
    // A link new to the catalog needs a catalog category for its part.
    expect((await edit(student, { url })).status).toBe(400);

    const res = await edit(student, {
      url,
      title: "REV Flanged Bearing",
      unitPriceCents: 399,
      catalogCategory: "Bearings & Bushings",
    });
    expect(res.status).toBe(200);
    const row = (await res.json()) as {
      url: string;
      vendor: string;
      title: string;
      catalogItemId: number;
    };
    expect(row).toMatchObject({ url, vendor: "REV Robotics", title: "REV Flanged Bearing" });

    const detail = await jsonAs<{
      catalogItemId: number;
      events: { action: string; note: string | null }[];
    }>(student, `/requests/${request.id}`);
    expect(detail.events.map((e) => e.action)).toEqual(["created", "replaced"]);
    expect(detail.events[1].note).toContain(
      "Was 2× Wrong Bearing from West Coast Products: https://wcproducts.com",
    );

    // Once approved, a mentor's new link is approved again with what it was.
    await jsonAs(mentor, `/requests/${request.id}/approve`, { method: "POST", body: {} });
    const again = `https://www.revrobotics.com/${crypto.randomUUID()}/`;
    expect(
      (await edit(mentor, { url: again, catalogCategory: "Bearings & Bushings" })).status,
    ).toBe(200);
    const after = await jsonAs<{ events: { action: string; note: string | null }[] }>(
      student,
      `/requests/${request.id}`,
    );
    expect(after.events.at(-1)).toMatchObject({ action: "reapproved" });
    expect(after.events.at(-1)?.note).toContain(
      `Was 2× REV Flanged Bearing from REV Robotics: ${url}`,
    );
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

describe("quantities", () => {
  // Quantities are whole numbers from 1 to 10000 wherever one is set.
  const bad = [1.5, 0.5, 0, -1, 10_001, "2"];

  it("are whole numbers when a request is made or edited", async () => {
    const { id: categoryId } = await newCategory(`Whole ${crypto.randomUUID()}`);
    const body = (quantity: unknown) => ({
      url: `https://wcproducts.com/products/${crypto.randomUUID()}`,
      title: "WCP Shaft Collar",
      quantity,
      unitPriceCents: 300,
      categoryId,
      catalogCategory: "Bearings & Bushings",
    });
    for (const quantity of bad) {
      const res = await callAs(student, "/requests", { method: "POST", body: body(quantity) });
      expect(res.status, String(quantity)).toBe(400);
    }
    const made = await jsonAs<Request & { quantity: number }>(
      student,
      "/requests",
      { method: "POST", body: body(3) },
      201,
    );
    expect(made.quantity).toBe(3);

    for (const quantity of bad) {
      const res = await callAs(student, `/requests/${made.id}`, {
        method: "PATCH",
        body: { quantity },
      });
      expect(res.status, String(quantity)).toBe(400);
    }
    const edited = await jsonAs<{ quantity: number }>(student, `/requests/${made.id}`, {
      method: "PATCH",
      body: { quantity: 4 },
    });
    expect(edited.quantity).toBe(4);
  });

  it("are whole numbers when a mentor approves with a new quantity", async () => {
    const { id: categoryId } = await newCategory(`Approve whole ${crypto.randomUUID()}`);
    const request = await newRequest(categoryId);
    for (const quantity of bad) {
      const res = await callAs(mentor, `/requests/${request.id}/approve`, {
        method: "POST",
        body: { quantity },
      });
      expect(res.status, String(quantity)).toBe(400);
    }
    const approved = await jsonAs<{ status: string; quantity: number }>(
      mentor,
      `/requests/${request.id}/approve`,
      { method: "POST", body: { quantity: 5 } },
    );
    expect(approved).toMatchObject({ status: "approved", quantity: 5 });
  });

  it("are whole numbers on a placed order", async () => {
    const { id: categoryId } = await newCategory(`Order whole ${crypto.randomUUID()}`);
    const request = await newRequest(categoryId);
    await jsonAs(mentor, `/requests/${request.id}/approve`, { method: "POST", body: {} });
    const order = (quantity: unknown) =>
      callAs(mentor, "/orders", {
        method: "POST",
        body: {
          vendor: "WCP",
          lines: [{ requestId: request.id, quantity, unitPriceCents: 450 }],
        },
      });
    for (const quantity of bad) {
      expect((await order(quantity)).status, String(quantity)).toBe(400);
    }
    expect((await order(2)).status).toBe(200);
    const placed = await jsonAs<{ status: string; quantity: number }>(
      student,
      `/requests/${request.id}`,
    );
    expect(placed).toMatchObject({ status: "ordered", quantity: 2 });
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
  type Found = {
    title: string;
    vendor: string;
    sku?: string;
    price?: number;
    available?: boolean;
    source: string;
    variants: { id: string; title: string; sku?: string; price?: number; available?: boolean }[];
    selectedVariantId?: string;
  };
  const lookUp = (link: string) =>
    jsonAs<Found>(student, `/lookup?url=${encodeURIComponent(link)}`, {}, 200);

  it("reads a Shopify store's product without the edge box", async () => {
    const found = await lookUp(`https://wcproducts.com/products/wcp-2073?v=${crypto.randomUUID()}`);
    expect(found).toMatchObject({
      source: "shopify",
      vendor: "wcproducts.com",
      title: '0.625" OD Cam Follower (#10-32) (2-Pack)',
      sku: "WCP-2073",
      price: 7.99,
      available: true,
    });
    expect(found.variants).toEqual([
      {
        id: "47177230319828",
        title: "Default Title",
        sku: "WCP-2073",
        price: 7.99,
        available: true,
      },
    ]);
  });

  it("follows a store's short link, and takes the option a ?variant= picks", async () => {
    const found = await lookUp(`https://andymark.com/am-0028?variant=12&v=${crypto.randomUUID()}`);
    expect(found).toMatchObject({
      title: "3/8 in. Round ID Flanged Shielded Bearing",
      selectedVariantId: "12",
      sku: "am-0028-10",
      price: 20,
      available: false,
    });
    expect(found.variants.map((v) => v.title)).toEqual(["Single", "Pack of 10"]);
  });

  it("reads REV's feed, a page's options as its variants", async () => {
    const one = await lookUp("https://www.revrobotics.com/rev-11-1107/");
    expect(one).toMatchObject({
      title: "Analog Pressure Sensor",
      sku: "REV-11-1107",
      price: 39.42,
    });
    const cables = await lookUp("https://www.revrobotics.com/jst-ph-4-pin-sensor-cables");
    expect(cables.title).toBe("JST PH 4-pin Sensor Cables");
    expect(cables.sku).toBeUndefined();
    expect(cables.variants).toEqual([
      {
        id: "REV-31-1407-PK4",
        title: "JST PH 4-pin Sensor Cable - 30cm - 4 Pack",
        sku: "REV-31-1407-PK4",
        price: 7,
        available: true,
      },
      {
        id: "REV-31-1408-PK4",
        title: "JST PH 4-pin Sensor Cable - 50cm - 4 Pack",
        sku: "REV-31-1408-PK4",
        price: 8,
        available: false,
      },
    ]);
  });

  it("asks the edge box for a product the store doesn't have, and reports it offline", async () => {
    const res = await callAs(
      student,
      `/lookup?url=${encodeURIComponent("https://wcproducts.com/products/x")}`,
    );
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe("the wishlist", () => {
  async function wish(categoryId: number, by = student) {
    return jsonAs<Request & { requesterName: string }>(
      by,
      "/requests",
      {
        method: "POST",
        body: {
          url: `https://wcproducts.com/products/${crypto.randomUUID()}`,
          title: "WCP Swerve X2",
          quantity: 4,
          categoryId,
          catalogCategory: "Bearings & Bushings",
          wishlist: true,
        },
      },
      201,
    );
  }

  it("keeps wished-for parts out of the requests, until anyone promotes one", async () => {
    const category = await newCategory(`Wishlist ${crypto.randomUUID()}`);
    const item = await wish(category.id);
    expect(item.status).toBe("wishlist");

    const requests = await jsonAs<Request[]>(mentor, "/requests");
    expect(requests.some((r) => r.id === item.id)).toBe(false);
    const wishlist = await jsonAs<Request[]>(student, "/requests?status=wishlist");
    expect(wishlist.some((r) => r.id === item.id)).toBe(true);

    // It isn't a request yet: no approving it, and it can't go on a list.
    expect(
      (await callAs(mentor, `/requests/${item.id}/approve`, { method: "POST", body: {} })).status,
    ).toBe(409);
    const list = await jsonAs<{ id: number }>(
      student,
      "/lists",
      { method: "POST", body: { name: `Wish list ${crypto.randomUUID()}` } },
      201,
    );
    expect(
      (
        await callAs(student, `/lists/${list.id}/items`, {
          method: "POST",
          body: { requestIds: [item.id] },
        })
      ).status,
    ).not.toBe(200);

    // Anyone edits it, and anyone promotes it: it's then their request, awaiting a mentor.
    expect(
      (
        await callAs(otherStudent, `/requests/${item.id}`, {
          method: "PATCH",
          body: { quantity: 2 },
        })
      ).status,
    ).toBe(200);
    const promoted = await jsonAs<Request>(otherStudent, `/requests/${item.id}/promote`, {
      method: "POST",
    });
    expect(promoted).toMatchObject({ status: "requested", requesterId: otherStudent.id });
    const after = await jsonAs<Request[]>(mentor, "/requests");
    expect(after.some((r) => r.id === item.id)).toBe(true);
    const detail = await jsonAs<{ events: { action: string; note: string | null }[] }>(
      mentor,
      `/requests/${item.id}`,
    );
    expect(detail.events.map((e) => e.action)).toEqual(["wished", "edited", "promoted"]);

    // Promoted once: it's a request now, so not again, and never deleted.
    expect((await callAs(student, `/requests/${item.id}/promote`, { method: "POST" })).status).toBe(
      409,
    );
    expect((await callAs(mentor, `/requests/${item.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("lets anyone remove a wished-for part", async () => {
    const category = await newCategory(`Wishlist ${crypto.randomUUID()}`);
    const item = await wish(category.id);
    expect(await jsonAs(otherStudent, `/requests/${item.id}`, { method: "DELETE" })).toEqual({
      ok: true,
    });
    expect((await callAs(student, `/requests/${item.id}`)).status).toBe(404);
  });

  it("never deletes a request", async () => {
    const category = await newCategory(`Wishlist ${crypto.randomUUID()}`);
    const request = await newRequest(category.id);
    expect((await callAs(student, `/requests/${request.id}`, { method: "DELETE" })).status).toBe(
      404,
    );
  });
});
