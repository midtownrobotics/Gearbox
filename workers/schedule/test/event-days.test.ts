import { env } from "cloudflare:test";
import { teamKey } from "@g3/site-config";
import { mentor } from "@g3/testing/users";
import { jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { eventDays } from "../src/lib/event-days";
import { momentOf } from "../src/lib/slots";

// When each published event opens and closes, for Pit's battery timers.

describe("momentOf", () => {
  it("turns an event's wall-clock slot into a moment", () => {
    // 8:00 in Chicago in March, after the change to daylight saving time: UTC-5.
    expect(new Date(momentOf("2027-03-16", 32, "America/Chicago")).toISOString()).toBe(
      "2027-03-16T13:00:00.000Z",
    );
    // Before it: UTC-6.
    expect(new Date(momentOf("2027-03-12", 32, "America/Chicago")).toISOString()).toBe(
      "2027-03-12T14:00:00.000Z",
    );
    // Midnight at the end of the day is the next day's start.
    expect(new Date(momentOf("2027-03-12", 96, "UTC")).toISOString()).toBe(
      "2027-03-13T00:00:00.000Z",
    );
  });
});

describe("event days", () => {
  it("lists published events' days in order, leaving out drafts and old events", async () => {
    const make = async (name: string, days: string[], publish: boolean) => {
      const { id } = await jsonAs<{ id: number }>(
        mentor,
        "/schedules",
        { method: "POST", body: { name, timeZone: "UTC" } },
        201,
      );
      for (const day of days) {
        await jsonAs(mentor, `/schedules/${id}/days/${day}`, {
          method: "PUT",
          body: { start: 32, end: 72 },
        });
      }
      if (publish) {
        await jsonAs(mentor, `/schedules/${id}`, { method: "PATCH", body: { published: true } });
      }
      return id;
    };
    const regional = await make("Event days regional", ["2030-04-02", "2030-04-01"], true);
    const draft = await make("Event days draft", ["2030-04-01"], false);
    const old = await make("Event days old", ["2030-03-01"], true);

    const now = Date.parse("2030-04-01T05:00:00Z");
    const database = (env as unknown as { SCHEDULE_DB: D1Database }).SCHEDULE_DB;
    const events = await eventDays(createDb(database), teamKey, now);
    const ids = events.map((event) => event.scheduleId);
    expect(ids).toContain(regional);
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(old);
    expect(events.find((event) => event.scheduleId === regional)?.days).toEqual([
      {
        day: "2030-04-01",
        opensAt: Date.parse("2030-04-01T08:00:00Z"),
        closesAt: Date.parse("2030-04-01T18:00:00Z"),
      },
      {
        day: "2030-04-02",
        opensAt: Date.parse("2030-04-02T08:00:00Z"),
        closesAt: Date.parse("2030-04-02T18:00:00Z"),
      },
    ]);
  });
});
