import { env } from "cloudflare:test";
import { withTeam } from "@g3/auth";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { type EventDays, catchUp, pauseTimers, timerChanges } from "../src/battery-timers";
import { createDb } from "../src/db";
import { batteries } from "../src/db/schema";
import type { AppEnv } from "../src/types";

// Battery timers that pause: Pause All and Unpause All, and the timers following the hours of the
// team's Schedule events (src/battery-timers.ts).

type Battery = { id: number; state: string; countedMs: number; countingSince: number | null };

const bindings = env as unknown as AppEnv["Bindings"] & { SCHEDULE: Fetcher };
const db = createDb(bindings.PIT_DB);
const HOUR = 3_600_000;

/** Gives a team's events to the stand-in Schedule (vitest.config.mts). */
const setEventDays = (teamId: string, events: EventDays[]) =>
  bindings.SCHEDULE.fetch(`http://schedule/test/teams/${teamId}/event-days`, {
    method: "PUT",
    body: JSON.stringify(events),
  });

describe("Pause All", () => {
  it("stops and restarts every timer without changing any battery's state", async () => {
    const team = teamUsers(newTeamId());
    const battery = await jsonAs<Battery>(
      team.student,
      "/batteries",
      { method: "POST", body: { name: "B1" } },
      201,
    );
    await jsonAs(team.student, `/batteries/${battery.id}/state`, {
      method: "PATCH",
      body: { state: "Charging" },
    });
    expect(await jsonAs(team.student, "/batteries/timers")).toMatchObject({ paused: false });

    expect(
      await jsonAs(team.student, "/batteries/timers", { method: "POST", body: { paused: true } }),
    ).toMatchObject({ paused: true });
    const [paused] = await jsonAs<Battery[]>(team.student, "/batteries");
    expect(paused).toMatchObject({ state: "Charging", countingSince: null });

    // A state change while paused starts its timer at zero, still paused.
    const moved = await jsonAs<Battery>(team.student, `/batteries/${battery.id}/state`, {
      method: "PATCH",
      body: { state: "Next Up" },
    });
    expect(moved).toMatchObject({ state: "Next Up", countedMs: 0, countingSince: null });

    expect(
      await jsonAs(team.kioskAdmin, "/batteries/timers", {
        method: "POST",
        body: { paused: false },
      }),
    ).toMatchObject({ paused: false });
    const [running] = await jsonAs<Battery[]>(team.student, "/batteries");
    expect(running.state).toBe("Next Up");
    expect(running.countingSince).toEqual(expect.any(Number));

    const bad = await callAs(team.student, "/batteries/timers", { method: "POST", body: {} });
    expect(bad.status).toBe(400);
  });
});

describe("event days", () => {
  it("puts every change in order", () => {
    expect(
      timerChanges([
        {
          days: [
            { day: "d1", opensAt: 10, closesAt: 20 },
            { day: "d2", opensAt: 30, closesAt: 40 },
          ],
        },
      ]),
    ).toEqual([
      { at: 10, kind: "reset" },
      { at: 20, kind: "pause" },
      { at: 30, kind: "resume" },
      { at: 40, kind: "pause" },
    ]);
  });

  it("resets and pauses at the first opening, pauses at closing and carries on the next day", async () => {
    const teamId = newTeamId();
    const open = Date.parse("2030-03-01T13:00:00Z");
    await setEventDays(teamId, [
      {
        days: [
          { day: "2030-03-01", opensAt: open, closesAt: open + 10 * HOUR },
          { day: "2030-03-02", opensAt: open + 24 * HOUR, closesAt: open + 34 * HOUR },
        ],
      },
    ]);
    // The first look only starts keeping track.
    expect(await catchUp(bindings, db, teamId, open - 3 * HOUR)).toEqual({
      paused: false,
      next: { at: open, kind: "reset" },
    });
    const [{ id }] = await db
      .insert(batteries)
      .values(
        withTeam(teamId, {
          name: "B2",
          state: "Charging",
          stateSince: open - 2 * HOUR,
          createdAt: 0,
          countedMs: 0,
          countingSince: open - 2 * HOUR,
        }),
      )
      .returning({ id: batteries.id });
    const timer = async () => {
      const [row] = await db.select().from(batteries).where(eq(batteries.id, id));
      return { countedMs: row.countedMs, countingSince: row.countingSince };
    };

    // The event opens: back to zero and paused, until someone unpauses two hours in.
    expect(await catchUp(bindings, db, teamId, open + HOUR)).toMatchObject({ paused: true });
    expect(await timer()).toEqual({ countedMs: 0, countingSince: null });
    await pauseTimers(db, teamId, false, open + 2 * HOUR);

    // It closes ten hours in, and someone looks an hour later: counted from the unpause to the
    // close, then paused.
    expect(await catchUp(bindings, db, teamId, open + 11 * HOUR)).toEqual({
      paused: true,
      next: { at: open + 24 * HOUR, kind: "resume" },
    });
    expect(await timer()).toEqual({ countedMs: 8 * HOUR, countingSince: null });

    // The next morning it carries on from when the event opened, without starting over.
    expect(await catchUp(bindings, db, teamId, open + 25 * HOUR)).toMatchObject({ paused: false });
    expect(await timer()).toEqual({ countedMs: 8 * HOUR, countingSince: open + 24 * HOUR });

    // Asked again, nothing is applied twice.
    await catchUp(bindings, db, teamId, open + 26 * HOUR);
    expect(await timer()).toEqual({ countedMs: 8 * HOUR, countingSince: open + 24 * HOUR });
  });
});
