import { env } from "cloudflare:test";
import { admin, kioskAdmin, mentor, otherStudent, student } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { peopleNow } from "../src/lib/now";
import { dueBlock, sendReminders } from "../src/reminders";

// An event's schedule from start to finish: made as a draft, given days, periods, attendees and
// blocks, published for students, and reminders sent on Slack.

type Detail = {
  schedule: { id: number; published: boolean };
  days: { day: string; start: number; end: number }[];
  periods: { id: number; label: string; start: number; end: number }[];
  attendees: { userId: string; displayName: string | null; active: boolean }[];
  assignments: { userId: string; day: string; start: number; end: number; roleId: number }[];
  roles: { id: number; name: string; archived: boolean }[];
};

const DAY = "2027-03-12";
let roleCount = 0;

async function newRole(name = `Role ${++roleCount}`) {
  return jsonAs<{ id: number }>(
    mentor,
    "/roles",
    { method: "POST", body: { name: `${name} ${crypto.randomUUID().slice(0, 6)}`, color: "blue" } },
    201,
  );
}

/** A draft with one day (8:00–18:00) and the two students attending. */
async function newSchedule() {
  const { id } = await jsonAs<{ id: number }>(
    mentor,
    "/schedules",
    { method: "POST", body: { name: "Regional", timeZone: "America/Chicago" } },
    201,
  );
  await jsonAs(mentor, `/schedules/${id}/days/${DAY}`, {
    method: "PUT",
    body: { start: 32, end: 72 },
  });
  await jsonAs(mentor, `/schedules/${id}/attendees`, {
    method: "POST",
    body: { userIds: [student.id, otherStudent.id] },
  });
  return id;
}

const paint = (id: number, changes: unknown[], user = mentor) =>
  callAs(user, `/schedules/${id}/assignments`, { method: "PUT", body: { changes } });

describe("schedules", () => {
  it("keeps drafts from students until published", async () => {
    const id = await newSchedule();
    expect((await callAs(student, `/schedules/${id}`)).status).toBe(404);
    expect((await jsonAs<{ id: number }[]>(student, "/schedules")).some((s) => s.id === id)).toBe(
      false,
    );

    await jsonAs(mentor, `/schedules/${id}`, { method: "PATCH", body: { published: true } });
    const detail = await jsonAs<Detail>(student, `/schedules/${id}`);
    expect(detail.schedule.published).toBe(true);
    expect(detail.days).toEqual([{ day: DAY, start: 32, end: 72 }]);
    expect(detail.attendees.map((a) => a.userId).sort()).toEqual(
      [student.id, otherStudent.id].sort(),
    );
    expect(detail.attendees.every((a) => a.active && a.displayName)).toBe(true);
  });

  it("lets mentors, admins and trusted students edit, never students or kiosks", async () => {
    const id = await newSchedule();
    const rename = (user: typeof mentor) =>
      callAs(user, `/schedules/${id}`, { method: "PATCH", body: { name: "Renamed" } });
    expect((await rename(student)).status).toBe(403);
    expect((await rename(kioskAdmin)).status).toBe(403);
    expect((await rename(admin)).status).toBe(200);

    // A student only mentors may trust.
    expect(
      (await callAs(otherStudent, `/editors/${otherStudent.id}`, { method: "PUT" })).status,
    ).toBe(403);
    await jsonAs(mentor, `/editors/${otherStudent.id}`, { method: "PUT" });
    expect((await rename(otherStudent)).status).toBe(200);
    expect((await callAs(otherStudent, "/editors")).status).toBe(403);
    expect(await jsonAs(mentor, "/editors")).toMatchObject([
      { userId: otherStudent.id, active: true },
    ]);
    await jsonAs(mentor, `/editors/${otherStudent.id}`, { method: "DELETE" });
    expect((await rename(otherStudent)).status).toBe(403);
  });

  it("refuses people who aren't on the team, and bad times and zones", async () => {
    const id = await newSchedule();
    const add = await callAs(mentor, `/schedules/${id}/attendees`, {
      method: "POST",
      body: { userIds: ["someone-else"] },
    });
    expect(add.status).toBe(400);
    const zone = await callAs(mentor, "/schedules", {
      method: "POST",
      body: { name: "X", timeZone: "Mars/Base" },
    });
    expect(zone.status).toBe(400);
    const hours = await callAs(mentor, `/schedules/${id}/days/${DAY}`, {
      method: "PUT",
      body: { start: 40, end: 40 },
    });
    expect(hours.status).toBe(400);
  });
});

describe("periods", () => {
  it("keeps periods within the day's hours and apart from each other", async () => {
    const id = await newSchedule();
    const add = (body: object) =>
      callAs(mentor, `/schedules/${id}/periods`, { method: "POST", body: { day: DAY, ...body } });

    const lunch = await add({ start: 48, end: 53, label: "Lunch" });
    expect(lunch.status).toBe(201);
    const { id: lunchId } = (await lunch.json()) as { id: number };

    const early = await add({ start: 28, end: 34, label: "Load in" });
    expect(early.status).toBe(400);
    expect(((await early.json()) as { error: string }).error).toMatch(/within the day's hours/);

    const clash = await add({ start: 52, end: 56, label: "Practice" });
    expect(((await clash.json()) as { error: string }).error).toMatch(/overlaps Lunch/);
    // Touching isn't overlapping: a period can start when the last ends.
    expect((await add({ start: 53, end: 56, label: "Practice" })).status).toBe(201);

    // Moving it is checked against the others, but not against itself.
    const moved = await callAs(mentor, `/schedules/${id}/periods/${lunchId}`, {
      method: "PATCH",
      body: { start: 47, end: 53 },
    });
    expect(moved.status).toBe(200);
  });

  it("takes a period as long as the whole day", async () => {
    const id = await newSchedule();
    const day = "2027-03-13";
    await jsonAs(mentor, `/schedules/${id}/days/${day}`, {
      method: "PUT",
      body: { start: 68, end: 80 },
    });
    const res = await callAs(mentor, `/schedules/${id}/periods`, {
      method: "POST",
      body: { day, start: 68, end: 80, label: "Practice" },
    });
    expect(res.status).toBe(201);
    const late = await callAs(mentor, `/schedules/${id}/periods`, {
      method: "POST",
      body: { day, start: 76, end: 84, label: "Late" },
    });
    expect(((await late.json()) as { error: string }).error).toMatch(/5:00 PM–8:00 PM/);
  });

  it("won't shrink a day past its periods", async () => {
    const id = await newSchedule();
    await jsonAs(
      mentor,
      `/schedules/${id}/periods`,
      { method: "POST", body: { day: DAY, start: 64, end: 72, label: "Pit close" } },
      201,
    );
    const shrink = await callAs(mentor, `/schedules/${id}/days/${DAY}`, {
      method: "PUT",
      body: { start: 32, end: 68 },
    });
    expect(shrink.status).toBe(409);
    expect(((await shrink.json()) as { error: string }).error).toMatch(/Pit close/);
  });
});

describe("assignments", () => {
  it("paints runs of blocks and reads them back as ranges", async () => {
    const id = await newSchedule();
    const pit = await newRole("Pit");
    const scouting = await newRole("Scouting");
    const res = await paint(id, [
      { userIds: [student.id, otherStudent.id], day: DAY, start: 36, end: 45, roleId: pit.id },
      // Later changes win: 10:00–10:30 becomes Scouting for one of them.
      { userIds: [student.id], day: DAY, start: 40, end: 42, roleId: scouting.id },
      // And null clears.
      { userIds: [otherStudent.id], day: DAY, start: 44, end: 45, roleId: null },
    ]);
    expect(res.status).toBe(200);

    const { assignments } = await jsonAs<Detail>(mentor, `/schedules/${id}`);
    expect(assignments.filter((a) => a.userId === student.id)).toEqual([
      { userId: student.id, day: DAY, start: 36, end: 40, roleId: pit.id },
      { userId: student.id, day: DAY, start: 40, end: 42, roleId: scouting.id },
      { userId: student.id, day: DAY, start: 42, end: 45, roleId: pit.id },
    ]);
    expect(assignments.filter((a) => a.userId === otherStudent.id)).toEqual([
      { userId: otherStudent.id, day: DAY, start: 36, end: 44, roleId: pit.id },
    ]);
  });

  it("refuses blocks outside the day, for people not attending, or in archived roles", async () => {
    const id = await newSchedule();
    const pit = await newRole("Pit");
    const block = { userIds: [student.id], day: DAY, start: 40, end: 44, roleId: pit.id };
    expect((await paint(id, [{ ...block, start: 20, end: 34 }])).status).toBe(400);
    expect((await paint(id, [{ ...block, day: "2027-03-13" }])).status).toBe(400);
    expect((await paint(id, [{ ...block, userIds: [mentor.id] }])).status).toBe(400);
    expect((await paint(id, [block], student)).status).toBe(403);

    await jsonAs(mentor, `/roles/${pit.id}`, { method: "PATCH", body: { archived: true } });
    expect((await paint(id, [block])).status).toBe(400);
  });

  it("clears blocks outside a day's new hours, and an attendee's with them", async () => {
    const id = await newSchedule();
    const pit = await newRole("Pit");
    await paint(id, [
      { userIds: [student.id, otherStudent.id], day: DAY, start: 32, end: 72, roleId: pit.id },
    ]);
    await jsonAs(mentor, `/schedules/${id}/days/${DAY}`, {
      method: "PUT",
      body: { start: 36, end: 68 },
    });
    await jsonAs(mentor, `/schedules/${id}/attendees/${otherStudent.id}`, { method: "DELETE" });
    const { assignments } = await jsonAs<Detail>(mentor, `/schedules/${id}`);
    expect(assignments).toEqual([
      { userId: student.id, day: DAY, start: 36, end: 68, roleId: pit.id },
    ]);
  });
});

describe("roles", () => {
  it("takes a preset or a custom color, and nothing else", async () => {
    const add = (color: string) =>
      callAs(mentor, "/roles", {
        method: "POST",
        body: { name: `Color ${crypto.randomUUID().slice(0, 6)}`, color },
      });
    const custom = await add("#1A2B3C");
    expect(custom.status).toBe(201);
    expect(await custom.json()).toMatchObject({ color: "#1a2b3c" });
    expect((await add("teal")).status).toBe(201);
    for (const bad of ["red", "#12345", "1a2b3c", "#gggggg", ""]) {
      expect((await add(bad)).status).toBe(400);
    }
  });

  it("is other unless given a type, which editors can change", async () => {
    const add = (body: Record<string, unknown>) =>
      callAs(mentor, "/roles", {
        method: "POST",
        body: { name: `Type ${crypto.randomUUID().slice(0, 6)}`, color: "blue", ...body },
      });
    const plain = await add({});
    expect(plain.status).toBe(201);
    const role = await plain.json<{ id: number; type: string }>();
    expect(role.type).toBe("other");
    const scouting = await add({ type: "scouting" });
    expect(await scouting.json()).toMatchObject({ type: "scouting" });
    expect((await add({ type: "drive" })).status).toBe(400);

    const changed = await jsonAs(mentor, `/roles/${role.id}`, {
      method: "PATCH",
      body: { type: "pit" },
    });
    expect(changed).toMatchObject({ type: "pit" });
    const renamed = await jsonAs(mentor, `/roles/${role.id}`, {
      method: "PATCH",
      body: { name: `Renamed ${crypto.randomUUID().slice(0, 6)}` },
    });
    expect(renamed).toMatchObject({ type: "pit" });
    const bad = await callAs(mentor, `/roles/${role.id}`, {
      method: "PATCH",
      body: { type: "Pit" },
    });
    expect(bad.status).toBe(400);
  });

  it("names each role once, and archives one that's in use instead of deleting it", async () => {
    const pit = await newRole("Pit");
    const [role] = (await jsonAs<{ id: number; name: string }[]>(student, "/roles")).filter(
      (r) => r.id === pit.id,
    );
    const again = await callAs(mentor, "/roles", {
      method: "POST",
      body: { name: ` ${role.name.toUpperCase()} `, color: "pink" },
    });
    expect(again.status).toBe(409);

    const id = await newSchedule();
    await paint(id, [{ userIds: [student.id], day: DAY, start: 40, end: 41, roleId: pit.id }]);
    expect((await callAs(mentor, `/roles/${pit.id}`, { method: "DELETE" })).status).toBe(409);

    const unused = await newRole("Unused");
    expect((await callAs(mentor, `/roles/${unused.id}`, { method: "DELETE" })).status).toBe(200);
  });
});

describe("who's on a role type now", () => {
  it("lists people whose role now is of the type, until it ends, once published", async () => {
    const pit = await jsonAs<{ id: number }>(
      mentor,
      "/roles",
      {
        method: "POST",
        body: { name: `Pit ${crypto.randomUUID().slice(0, 6)}`, color: "orange", type: "pit" },
      },
      201,
    );
    const other = await newRole("Drive");
    const id = await newSchedule();
    // 10:00–11:00 in the pit, then 11:00–11:30 still in the pit for one, driving for the other.
    await paint(id, [
      { userIds: [student.id], day: DAY, start: 40, end: 46, roleId: pit.id },
      { userIds: [otherStudent.id], day: DAY, start: 40, end: 44, roleId: other.id },
      { userIds: [otherStudent.id], day: DAY, start: 44, end: 46, roleId: pit.id },
    ]);
    const db = createDb((env as unknown as { SCHEDULE_DB: D1Database }).SCHEDULE_DB);
    const at = async (iso: string) =>
      (await peopleNow(env as never, db, student.teamId, "pit", new Date(iso))).filter(
        (p) => p.scheduleId === id,
      );
    // 10:30 AM in Chicago (CST, UTC−6) on the day.
    const halfPastTen = `${DAY}T16:30:00Z`;
    expect(await at(halfPastTen)).toEqual([]);

    await jsonAs(mentor, `/schedules/${id}`, { method: "PATCH", body: { published: true } });
    expect(await at(halfPastTen)).toMatchObject([
      { userId: student.id, roleId: pit.id, until: "11:30" },
    ]);
    expect((await at(`${DAY}T17:15:00Z`)).map((p) => p.userId).sort()).toEqual(
      [student.id, otherStudent.id].sort(),
    );
    // After the day's hours, or another day, nobody.
    expect(await at(`${DAY}T23:30:00Z`)).toEqual([]);
    expect(await at("2027-03-13T16:30:00Z")).toEqual([]);
  });

  it("is for anyone signed in, kiosks too, and takes only a known type", async () => {
    expect((await callAs(kioskAdmin, "/now?type=pit")).status).toBe(200);
    expect((await callAs(student, "/now?type=drive")).status).toBe(400);
    expect((await callAs(student, "/now")).status).toBe(400);
  });
});

describe("reminders", () => {
  it("is due a few minutes before each block, not during it", () => {
    const schedule = { notifyMinutes: 5, timeZone: "America/Chicago" };
    // 9:55 in Chicago (CST): the 10:00 block is 5 minutes away.
    expect(dueBlock(schedule, new Date("2027-03-12T15:55:00Z"))).toEqual({ day: DAY, slot: 40 });
    // 9:57: still due (sent once, whichever run gets there first).
    expect(dueBlock(schedule, new Date("2027-03-12T15:57:00Z"))).toEqual({ day: DAY, slot: 40 });
    // 9:50: the 9:45 block has started; 10:00 isn't due yet.
    expect(dueBlock(schedule, new Date("2027-03-12T15:50:00Z"))).toBeNull();
    // Right at a block's start, with reminders at 0 minutes.
    expect(dueBlock({ ...schedule, notifyMinutes: 0 }, new Date("2027-03-12T16:00:00Z"))).toEqual({
      day: DAY,
      slot: 40,
    });
  });

  it("DMs each person once when their role changes, only for published schedules", async () => {
    const id = await newSchedule();
    const pit = await newRole("Pit");
    const lunch = await newRole("Lunch");
    await paint(id, [
      { userIds: [student.id, otherStudent.id], day: DAY, start: 36, end: 48, roleId: pit.id },
      // At 10:00, one goes to Lunch until 10:30; the other stays on Pit (no message).
      { userIds: [student.id], day: DAY, start: 40, end: 42, roleId: lunch.id },
    ]);
    const dms = async () =>
      (
        (await (
          await (env as unknown as { G3ID: Fetcher }).G3ID.fetch(
            `http://g3id/api/internal/teams/${student.teamId}/chat/dm-members`,
          )
        ).json()) as { userIds: string[]; text: string }[]
      ).filter((dm) => dm.text.includes(`Regional ${id}`));

    await jsonAs(mentor, `/schedules/${id}`, { method: "PATCH", body: { name: `Regional ${id}` } });
    const at = new Date("2027-03-12T15:55:00Z");
    await sendReminders(env as never, at);
    expect(await dms()).toEqual([]);

    await jsonAs(mentor, `/schedules/${id}`, { method: "PATCH", body: { published: true } });
    await sendReminders(env as never, at);
    await sendReminders(env as never, new Date("2027-03-12T15:56:00Z"));
    expect(await dms()).toEqual([
      {
        userIds: [student.id],
        text: expect.stringMatching(/at 10:00 AM you're on \*\*Lunch .*\*\* until 10:30 AM/),
      },
    ]);
  });
});
