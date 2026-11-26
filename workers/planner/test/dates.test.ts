// SPDX-License-Identifier: AGPL-3.0-only

import { kioskAdmin, student } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { parseDueDate } from "../src/lib/input";
import { dueLabel, overviewText } from "../src/lib/overview";

type Card = {
  id: number;
  title: string;
  column: string | number;
  dueDate: string | null;
  startsOn: string | null;
};

const add = (body: Record<string, unknown>) =>
  jsonAs<Card>(student, "/cards", { method: "POST", body }, 201);
const find = async (id: number) =>
  ((await jsonAs(student, "/cards")) as Card[]).find((c) => c.id === id);

describe("due dates", () => {
  it("are set when a card is added, changed and cleared", async () => {
    const card = await add({ title: "Due soon", dueDate: "2026-12-01" });
    expect(card.dueDate).toBe("2026-12-01");
    const patch = (body: unknown) =>
      callAs(student, `/cards/${card.id}`, { method: "PATCH", body });
    expect((await patch({ dueDate: "2026-12-05" })).status).toBe(200);
    expect((await find(card.id))?.dueDate).toBe("2026-12-05");
    // Only the date: the title stays.
    expect((await find(card.id))?.title).toBe("Due soon");
    expect((await patch({ dueDate: null })).status).toBe(200);
    expect((await find(card.id))?.dueDate).toBeNull();
  });

  it("must be a real day", async () => {
    for (const dueDate of ["2026-02-30", "tomorrow", "2026-1-5", 20261201]) {
      const res = await callAs(student, "/cards", {
        method: "POST",
        body: { title: "Bad date", dueDate },
      });
      expect(res.status).toBe(400);
    }
    expect(parseDueDate("2028-02-29")).toBe("2028-02-29");
    expect(parseDueDate(undefined)).toBeUndefined();
    expect(parseDueDate("")).toBeNull();
  });

  it("aren't changed from a kiosk", async () => {
    const card = await add({ title: "Kiosk" });
    const res = await callAs(kioskAdmin, `/cards/${card.id}`, {
      method: "PATCH",
      body: { dueDate: "2026-12-01" },
    });
    expect(res.status).toBe(403);
  });

  it("show in the overview, but not on finished cards", () => {
    const year = new Date().getUTCFullYear();
    const text = overviewText(
      [
        { id: 1, title: "Soon", status: "not_started", names: [], dueDate: `${year}-03-06` },
        { id: 2, title: "Later", status: "in_progress", names: ["Sam"], dueDate: "2099-01-02" },
        { id: 3, title: "Finished", status: "done", names: [], dueDate: `${year}-03-06` },
      ],
      new Map([[3, "not_started"]] as const),
      "https://board",
      "Friday, March 6",
    );
    expect(text).toContain(`• Soon · due ${dueLabel(`${year}-03-06`)}`);
    expect(dueLabel("2099-01-02")).toBe("Fri, Jan 2, 2099");
    expect(text).toContain("• Later (Sam) · due Fri, Jan 2, 2099");
    expect(text).toContain("• ~~Finished~~\n");
  });
});

describe("scheduled cards", () => {
  it("are added with the day they go on the board, and moving one puts it on now", async () => {
    const card = await add({ title: "Next week", startsOn: "2099-06-01" });
    expect(card).toMatchObject({ column: "not_started", startsOn: "2099-06-01" });
    const res = await callAs(student, `/cards/${card.id}/move`, {
      method: "PUT",
      body: { column: "done", index: 0 },
    });
    expect(res.status).toBe(200);
    expect(await find(card.id)).toMatchObject({ column: "done", startsOn: null });
  });

  it("can be rescheduled or put on the board at once", async () => {
    const card = await add({ title: "Reschedule", startsOn: "2099-06-01" });
    const patch = (body: unknown) =>
      callAs(student, `/cards/${card.id}`, { method: "PATCH", body });
    await patch({ startsOn: "2099-07-01" });
    expect((await find(card.id))?.startsOn).toBe("2099-07-01");
    await patch({ startsOn: null });
    expect((await find(card.id))?.startsOn).toBeNull();
  });
});
