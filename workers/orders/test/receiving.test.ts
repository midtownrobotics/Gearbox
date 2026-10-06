import { env } from "cloudflare:test";
import { mentor, student } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// A team's real order history (an imported order sheet) has far more lines than D1 binds in one
// statement (100). These pages and batch actions must still work (lib/chunks.ts).

const db = (env as unknown as { ORDERS_DB: D1Database }).ORDERS_DB;
const now = Math.floor(Date.now() / 1000);

/** `count` requests on placed orders: about one in three already received. */
async function history(count: number): Promise<number[]> {
  const category = await db
    .prepare("INSERT INTO budget_categories (name, created_at) VALUES (?, ?) RETURNING id")
    .bind(`Big history ${crypto.randomUUID()}`, now)
    .first<{ id: number }>();
  const order = await db
    .prepare(
      "INSERT INTO vendor_orders (vendor, placed_by_id, placed_by_name, placed_at) VALUES ('WCP', ?, 'Mentor', ?) RETURNING id",
    )
    .bind(mentor.id, now)
    .first<{ id: number }>();
  const inserted = await db.batch<{ id: number }>(
    Array.from({ length: count }, (_, i) =>
      db
        .prepare(
          `INSERT INTO order_requests (requester_id, requester_name, url, vendor, title, quantity,
             category_id, reason, status, order_id, created_at, updated_at)
           VALUES (?, 'Student', 'https://example.com', 'WCP', ?, 1, ?, 'test', ?, ?, ?, ?)
           RETURNING id`,
        )
        .bind(
          student.id,
          `Part ${i}`,
          category?.id,
          i % 3 ? "ordered" : "received",
          order?.id,
          now,
          now,
        ),
    ),
  );
  return inserted.map((r) => r.results[0].id);
}

describe("a long order history", () => {
  it("loads the Receiving page", async () => {
    await history(150);
    const body = await jsonAs<{ open: { lines: unknown[] }[] }>(student, "/orders/receiving");
    expect(body.open.length).toBeGreaterThan(0);
  });

  it("receives more than 100 items at once", async () => {
    const ids = await history(150);
    const res = await jsonAs<{ received: number[] }>(mentor, "/orders/receive", {
      method: "POST",
      body: { ids },
    });
    expect(res.received.length).toBe(100); // the two in three that were still on order
  });

  it("adds more than 100 requests to a list at once", async () => {
    const ids = await history(150);
    const list = await jsonAs<{ id: number }>(
      student,
      "/lists",
      { method: "POST", body: { name: `Big list ${crypto.randomUUID()}` } },
      201,
    );
    const res = await callAs(student, `/lists/${list.id}/items`, {
      method: "POST",
      body: { requestIds: ids },
    });
    expect(res.status).toBe(200);
  });
});
