import { describe, expect, it } from "vitest";
import {
  clockLabel,
  isDay,
  isRange,
  isTimeZone,
  overlaps,
  slotAt,
  slotOf,
  timeOf,
} from "../src/lib/slots";

describe("slots", () => {
  it("turns times on the 15-minute grid into slots and back", () => {
    expect(slotOf("00:00")).toBe(0);
    expect(slotOf("12:00")).toBe(48);
    expect(slotOf("13:15")).toBe(53);
    expect(slotOf("24:00")).toBe(96);
    expect(timeOf(53)).toBe("13:15");
    expect(timeOf(0)).toBe("00:00");
    expect(clockLabel(0)).toBe("12:00 AM");
    expect(clockLabel(53)).toBe("1:15 PM");
    expect(clockLabel(48)).toBe("12:00 PM");
  });

  it("refuses times off the grid or out of the day", () => {
    for (const time of ["12:10", "12:60", "24:15", "9", "noon", ""])
      expect(slotOf(time)).toBeNull();
  });

  it("checks ranges and finds overlaps (a range ends before its last slot)", () => {
    expect(isRange(48, 53)).toBe(true);
    expect(isRange(53, 53)).toBe(false);
    expect(isRange(90, 97)).toBe(false);
    expect(isRange(1.5, 4)).toBe(false);
    expect(overlaps([48, 53], [53, 60])).toBe(false);
    expect(overlaps([48, 53], [52, 60])).toBe(true);
  });

  it("checks dates and time zones", () => {
    expect(isDay("2027-03-12")).toBe(true);
    expect(isDay("2027-02-30")).toBe(false);
    expect(isDay("3/12/2027")).toBe(false);
    expect(isTimeZone("America/Chicago")).toBe(true);
    expect(isTimeZone("Mars/Base")).toBe(false);
  });

  it("finds the block a moment falls in, in the event's zone, across daylight saving", () => {
    // 15:07 UTC on 12 March 2027 is 9:07 in Chicago (CST): the 9:00 block.
    expect(slotAt(new Date("2027-03-12T15:07:00Z"), "America/Chicago")).toMatchObject({
      day: "2027-03-12",
      slot: 36,
    });
    // The same UTC time on 15 March, after the change to CDT, is 10:07.
    expect(slotAt(new Date("2027-03-15T15:07:00Z"), "America/Chicago")).toMatchObject({
      day: "2027-03-15",
      slot: 40,
    });
  });
});
