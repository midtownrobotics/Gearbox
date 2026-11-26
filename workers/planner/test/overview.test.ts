// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { type OverviewCard, overviewDate, overviewText, parseTimeZone } from "../src/lib/overview";

// Meeting overviews: the text, the channel setting, sending one, keeping it up to date, and
// /gb-add from the team's chat.

const g3id = (env as unknown as { G3ID: Fetcher }).G3ID;
const BOARD = "https://1648-planner.example";
const DATE = "Tuesday, November 17, 2026";

type Card = { id: number; title: string };

/** A team of its own, so its board is only what the test made. */
function team() {
  const users = teamUsers(newTeamId());
  const add = (title: string) =>
    jsonAs<Card>(users.student, "/cards", { method: "POST", body: { title } }, 201);
  const move = (card: Card, column: "not_started" | "done" | number) =>
    callAs(users.student, `/cards/${card.id}/move`, { method: "PUT", body: { column, index: 0 } });
  /** A middle column, made by a mentor. */
  const middle = async (name: string) =>
    (
      await jsonAs<{ id: number }>(
        users.mentor,
        "/columns",
        { method: "POST", body: { name } },
        201,
      )
    ).id;
  const posts = async () =>
    (await (
      await g3id.fetch(`http://g3id/internal/teams/${users.teamId}/chat/message`)
    ).json()) as { channel: string; text: string }[];
  const edits = async () =>
    (await (await g3id.fetch(`http://g3id/internal/teams/${users.teamId}/chat/edits`)).json()) as {
      message: { channel: string; id: string };
      text: string;
    }[];
  /** The overview's text after the edits in flight (they run after each answer) arrive. */
  async function lastEdit(until: (text: string) => boolean) {
    for (let i = 0; i < 50; i++) {
      const text = (await edits()).at(-1)?.text;
      if (text && until(text)) return text;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return (await edits()).at(-1)?.text ?? "";
  }
  const pickChannel = () =>
    callAs(users.mentor, "/settings", { method: "PUT", body: { overviewChannel: "C0123ABC" } });
  return { ...users, add, move, middle, posts, edits, lastEdit, pickChannel };
}

describe("an overview's text", () => {
  const card = (
    id: number,
    title: string,
    status: OverviewCard["status"],
    names: string[] = [],
  ) => ({
    id,
    title,
    status,
    names,
  });

  it("lists Not Started and Started, crossing off what's finished where it was", () => {
    const text = overviewText(
      [
        card(1, "Order bolts", "not_started"),
        card(2, "Wire it", "in_progress", ["Sam", "Jo"]),
        card(3, "Done before", "done"),
        card(4, "Finished from Started", "done"),
        card(5, "Finished from Not Started", "done"),
      ],
      new Map([
        [1, "not_started"],
        [2, "in_progress"],
        [4, "in_progress"],
        [5, "not_started"],
      ] as const),
      BOARD,
      DATE,
    );
    expect(text).toContain("**Not Started**\n• Order bolts\n• ~~Finished from Not Started~~\n");
    expect(text).toContain("**Started**\n• Wire it (Sam, Jo)\n• ~~Finished from Started~~\n");
    expect(text).not.toContain("Done before");
    expect(text).not.toContain("**Done**");
    expect(text).not.toContain("In Progress");
    expect(text).toContain(`[Open the board](${BOARD})`);
  });

  it("has the day it was sent in its heading, in the sender's time zone", () => {
    expect(overviewText([], new Map(), BOARD, DATE)).toMatch(
      /^\*\*📋 Meeting overview · Tuesday, November 17, 2026\*\*\n/,
    );
    // 02:00 UTC on the 18th is still the 17th in New York.
    const late = Date.UTC(2026, 10, 18, 2) / 1000;
    expect(overviewDate(late, "America/New_York")).toBe("Tuesday, November 17, 2026");
    expect(overviewDate(late, "UTC")).toBe("Wednesday, November 18, 2026");
    expect(parseTimeZone("America/New_York")).toBe("America/New_York");
    expect(parseTimeZone("Not/AZone")).toBeNull();
    expect(parseTimeZone(5)).toBeNull();
  });

  it("says when a list is empty", () => {
    const text = overviewText([], new Map(), BOARD, DATE);
    expect(text).toContain("**Not Started**\nNothing here.");
    expect(text).toContain("**Started**\nNothing here.");
  });

  it("shows titles as written, never as formatting or links", () => {
    const text = overviewText(
      [card(1, "**bold** [x](https://evil) ~~no~~", "not_started")],
      new Map(),
      BOARD,
      DATE,
    );
    expect(text).toContain("• bold (x)(https://evil) no");
  });

  it("fits one Discord message however long the board", () => {
    const many = Array.from({ length: 300 }, (_, i) => card(i, `Task number ${i}`, "not_started"));
    const text = overviewText(many, new Map(), BOARD, DATE);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/…and \d+ more/);
    expect(text).toContain("Open the board");
  });
});

describe("the overview channel", () => {
  it("is chosen by mentors and admins, not students or kiosks", async () => {
    const t = team();
    expect((await callAs(t.student, "/settings")).status).toBe(403);
    expect((await t.pickChannel()).status).toBe(200);
    expect(await jsonAs(t.admin, "/settings")).toEqual({ overviewChannel: "C0123ABC" });
    const bad = await callAs(t.mentor, "/settings", {
      method: "PUT",
      body: { overviewChannel: "#general" },
    });
    expect(bad.status).toBe(400);
    const cleared = await callAs(t.admin, "/settings", {
      method: "PUT",
      body: { overviewChannel: null },
    });
    expect(await cleared.json()).toEqual({ overviewChannel: null });
  });
});

describe("sending an overview", () => {
  it("needs a channel first, and is for mentors and admins", async () => {
    const t = team();
    const res = await callAs(t.mentor, "/overviews", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Admin page") });
    expect((await callAs(t.student, "/overviews", { method: "POST" })).status).toBe(403);
  });

  it("posts the board, then keeps it up to date as cards change", async () => {
    const t = team();
    const bolts = await t.add("Order bolts");
    const wire = await t.add("Wire it");
    await t.pickChannel();
    expect(await jsonAs(t.student, "/overviews/latest")).toEqual({ postedAt: null });

    const timeZone = "Pacific/Kiritimati";
    const send = await callAs(t.mentor, "/overviews", { method: "POST", body: { timeZone } });
    expect(send.status).toBe(200);
    const { postedAt } = (await send.json()) as { postedAt: number };
    const [posted] = await t.posts();
    expect(posted.channel).toBe("C0123ABC");
    // Dated in the sender's time zone, which edits keep.
    const heading = `**📋 Meeting overview · ${overviewDate(postedAt, timeZone)}**`;
    expect(posted.text.startsWith(heading)).toBe(true);
    expect(posted.text).toContain("• Order bolts");
    expect(posted.text).toContain("• Wire it");
    expect(await jsonAs(t.student, "/overviews/latest")).toEqual({ postedAt: expect.any(Number) });

    // Started: under Started. Finished: crossed off where it was.
    const doing = await t.middle("Doing");
    await t.move(wire, doing);
    expect(await t.lastEdit((text) => text.includes("**Started**\n• Wire it"))).toContain(
      "**Started**\n• Wire it",
    );
    await t.move(wire, "done");
    expect(await t.lastEdit((text) => text.includes("~~Wire it~~"))).toContain(
      "**Started**\n• ~~Wire it~~",
    );
    await t.move(bolts, "done");
    expect(await t.lastEdit((text) => text.includes("~~Order bolts~~"))).toContain(
      "**Not Started**\n• ~~Order bolts~~",
    );

    // Added: listed. Deleted: gone.
    const paint = await t.add("Paint the bumpers");
    expect(await t.lastEdit((text) => text.includes("Paint the bumpers"))).toContain(
      "• Paint the bumpers",
    );
    await callAs(t.admin, `/cards/${paint.id}`, { method: "DELETE" });
    expect(await t.lastEdit((text) => !text.includes("Paint the bumpers"))).not.toContain(
      "Paint the bumpers",
    );
    expect((await t.edits()).every((e) => e.text.startsWith(heading))).toBe(true);
    // Every edit is to the message that was posted.
    expect(new Set((await t.edits()).map((e) => e.message.channel))).toEqual(new Set(["C0123ABC"]));
  });

  it("only keeps the latest overview up to date once another is sent", async () => {
    const t = team();
    await t.add("Before both");
    await t.pickChannel();
    const send = () => callAs(t.mentor, "/overviews", { method: "POST", body: {} });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect(await t.posts()).toHaveLength(2);

    await t.add("After both");
    expect(await t.lastEdit((text) => text.includes("After both"))).toContain("• After both");
    // The stub numbers each team's posts: the second overview's message ends ".2".
    const edited = new Set((await t.edits()).map((e) => e.message.id.split(".").at(-1)));
    expect(edited).toEqual(new Set(["2"]));
  });

  it("leaves out cards scheduled for a later day", async () => {
    const t = team();
    await t.add("On the board");
    await jsonAs(
      t.student,
      "/cards",
      { method: "POST", body: { title: "Not yet", startsOn: "2099-01-01" } },
      201,
    );
    await t.pickChannel();
    expect((await callAs(t.mentor, "/overviews", { method: "POST", body: {} })).status).toBe(200);
    const [posted] = await t.posts();
    expect(posted.text).toContain("• On the board");
    expect(posted.text).not.toContain("Not yet");
  });

  it("edits nothing for a team that hasn't sent one", async () => {
    const t = team();
    await t.add("Quiet");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await t.edits()).toEqual([]);
  });
});

describe("/gb-add", () => {
  const command = (teamId: string, body: unknown) =>
    call(`/internal/teams/${teamId}/commands/gb-add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("adds a card to Not Started under the member's name, and the overview follows", async () => {
    const t = team();
    await t.pickChannel();
    await callAs(t.mentor, "/overviews", { method: "POST" });

    const res = await command(t.teamId, { userId: t.student.id, text: "  Order more bolts " });
    expect(await res.json()).toEqual({ reply: 'Added "Order more bolts" to Not Started.' });
    const cards = (await jsonAs(t.student, "/cards")) as { title: string; column: string }[];
    expect(cards).toContainEqual(
      expect.objectContaining({ title: "Order more bolts", column: "not_started" }),
    );
    expect(await t.lastEdit((text) => text.includes("Order more bolts"))).toContain(
      "• Order more bolts",
    );
  });

  it("says how to use it when there's nothing after it", async () => {
    const t = team();
    const res = await command(t.teamId, { userId: t.student.id, text: " " });
    expect(((await res.json()) as { reply: string }).reply).toContain("/gb-add Order more bolts");
    expect(await jsonAs(t.student, "/cards")).toEqual([]);
  });
});
