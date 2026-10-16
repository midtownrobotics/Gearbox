import { admin, student } from "@g3/testing/users";
import { jsonAs } from "@g3/testing/worker";
import { beforeAll, describe, expect, it } from "vitest";
import { boxCall } from "./box";

// The Network pages' date ranges and what they say about them (src/modules/network/range.ts):
// a range's days, total, average day, busiest and quietest days, and its weekdays and hours.
// The box hasn't reported a time zone, so its days are UTC days.

let key = "";
const at = (iso: string) => Date.parse(iso) / 1000;
const mac = "aa:bb:cc:00:00:42";

beforeAll(async () => {
  key = (await jsonAs<{ key: string }>(admin, "/box/key", { method: "POST" }, 201)).key;
  const res = await boxCall(admin.teamId, key, "/agent/network/usage", {
    method: "POST",
    body: JSON.stringify({
      samples: [
        // Tuesday 1 September, 10am: 1,000 down.
        [at("2026-09-01T10:00:00Z"), "_wan", 1000, 0],
        // Wednesday 2 September, 2pm and 3pm: 3,000 down, then 1,000 up; a device's share.
        [at("2026-09-02T14:00:00Z"), "_wan", 3000, 0],
        [at("2026-09-02T15:00:00Z"), "_wan", 0, 1000],
        [at("2026-09-02T14:00:00Z"), mac, 2500, 0],
      ],
      clients: [{ mac, hostname: "range-laptop", ip: "192.168.50.42" }],
    }),
  });
  expect(res.status).toBe(200);
});

type Overview = {
  range: { fromDay: string; toDay: string; days: number; isCycle: boolean };
  daily: { day: string; dl: number; ul: number }[];
  hourly: { hour: number; dl: number; ul: number }[];
  stats: {
    total: { dl: number; ul: number };
    perDay: number;
    busiest: { day: string } | null;
    quietest: { day: string } | null;
    byWeekday: { day: string; bytes: number; days: number }[];
    byHour: number[] | null;
    singleDay: boolean;
  };
  topClients: { mac: string; dl: number }[];
};

describe("a range of days", () => {
  it("gives its days, total, average day, busiest and quietest days, weekdays and hours", async () => {
    const o = await jsonAs<Overview>(student, "/network/overview?from=2026-09-01&to=2026-09-03");
    expect(o.range).toMatchObject({ fromDay: "2026-09-01", toDay: "2026-09-03", days: 3 });
    expect(o.daily.map((d) => d.day)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(o.stats.total).toEqual({ dl: 4000, ul: 1000 });
    expect(o.stats.perDay).toBeCloseTo(5000 / 3);
    expect(o.stats.busiest?.day).toBe("2026-09-02");
    expect(o.stats.quietest?.day).toBe("2026-09-03");
    const weekday = Object.fromEntries(o.stats.byWeekday.map((w) => [w.day, w.bytes]));
    expect(weekday).toMatchObject({ Tue: 1000, Wed: 4000, Thu: 0, Mon: 0 });
    expect(o.stats.byHour?.[10]).toBeCloseTo(1000 / 3);
    expect(o.stats.byHour?.[14]).toBeCloseTo(3000 / 3);
    expect(o.stats.singleDay).toBe(false);
    // The device's share of the range.
    expect(o.topClients.find((c) => c.mac === mac)?.dl).toBe(2500);
  });

  it("zooms to one day: its hours", async () => {
    const o = await jsonAs<Overview>(student, "/network/overview?from=2026-09-02&to=2026-09-02");
    expect(o.stats.singleDay).toBe(true);
    expect(o.stats.total).toEqual({ dl: 3000, ul: 1000 });
    // Every hour of the day, so the chart's hours are evenly spaced; only two had traffic.
    expect(o.hourly).toHaveLength(24);
    expect(o.hourly[0].hour).toBe(at("2026-09-02T00:00:00Z"));
    expect(o.hourly.filter((h) => h.dl + h.ul > 0).map((h) => h.hour)).toEqual([
      at("2026-09-02T14:00:00Z"),
      at("2026-09-02T15:00:00Z"),
    ]);
    const device = await jsonAs<Overview>(
      student,
      `/network/clients/${encodeURIComponent(mac)}?from=2026-09-02&to=2026-09-02`,
    );
    expect(device.stats.total).toEqual({ dl: 2500, ul: 0 });
    expect(device.hourly).toHaveLength(24);
    expect(device.hourly.filter((h) => h.dl > 0).map((h) => h.dl)).toEqual([2500]);
  });

  it("is the billing cycle when none is asked for", async () => {
    const o = await jsonAs<Overview>(student, "/network/overview");
    expect(o.range.isCycle).toBe(true);
  });

  it("refuses a range that runs backwards, isn't dates, or is too long", async () => {
    for (const q of [
      "from=2026-09-05&to=2026-09-01",
      "from=yesterday",
      "from=2024-01-01&to=2026-01-01",
    ]) {
      const res = await jsonAs<{ error: string }>(student, `/network/overview?${q}`, {}, 400);
      expect(res.error).toBeTruthy();
    }
  });

  it("goes for the site pages too", async () => {
    const sites = await jsonAs<{ range: { fromDay: string; days: number } }>(
      admin,
      "/network/sites?from=2026-09-01&to=2026-09-07",
    );
    expect(sites.range).toMatchObject({ fromDay: "2026-09-01", days: 7 });
  });
});
