import { describe, expect, it } from "vitest";
import {
  SAFE_TEXT,
  allowedText,
  baseVocabulary,
  demoBlocked,
  disallowedText,
  nextSafe,
  visitorFor,
} from "../src/index.ts";

const words = baseVocabulary();

describe("allowedText", () => {
  it("takes every safe string and the members' names", () => {
    for (const list of Object.values(SAFE_TEXT)) {
      for (const text of list) expect(allowedText(text, words), text).toBe(true);
    }
    expect(allowedText(visitorFor("mentor").name, words)).toBe(true);
  });

  it("takes machine values", () => {
    for (const value of [
      "2026-10-15",
      "2026-10-15T16:00:00.000Z",
      "#a32035",
      "8.9",
      "in-progress",
      "checked_out",
      "orders:request:12",
      "3f2a1b9c-0d4e-4f5a-8b6c-7d8e9f0a1b2c",
      "demo-9999-03",
    ]) {
      expect(allowedText(value, words), value).toBe(true);
    }
  });

  it("takes time zones, which Schedule sends", () => {
    expect(allowedText("America/New_York", words)).toBe(true);
  });

  it("takes safe words put together, as a naming template does", () => {
    expect(allowedText("WCP WCP-0451 – Swerve module", words)).toBe(true);
  });

  it("refuses typed text", () => {
    expect(allowedText("Hello from a stranger", words)).toBe(false);
    expect(allowedText("Visit my website", words)).toBe(false);
    expect(allowedText("x".repeat(2001), words)).toBe(false);
  });

  it("finds typed text deep in a body, keys included", () => {
    expect(disallowedText({ a: [{ b: "Practice day" }], n: 4 }, words)).toBeNull();
    expect(disallowedText({ a: [{ b: "Buy my stuff" }] }, words)).toBe("Buy my stuff");
    expect(disallowedText({ "Buy my stuff": 1 }, words)).toBe("Buy my stuff");
    expect(disallowedText({ needBy: "2026-11-01", 12: "Gusset" }, words)).toBeNull();
  });
});

describe("demoBlocked", () => {
  it("refuses what reaches outside the demo", () => {
    expect(demoBlocked("id", "GET", "/slack/install")).toBe(true);
    expect(demoBlocked("platform", "PUT", "/team/library/orders")).toBe(true);
    expect(demoBlocked("edge", "POST", "/box/key")).toBe(true);
    expect(demoBlocked("id", "PUT", "/admin/team/ui")).toBe(true);
    expect(demoBlocked("id", "DELETE", "/admin/users/demo-9999-04")).toBe(true);
  });

  it("lets ordinary work through", () => {
    expect(demoBlocked("orders", "POST", "/requests")).toBe(false);
    expect(demoBlocked("id", "POST", "/admin/users/demo-9999-04/approve")).toBe(false);
  });
});

describe("nextSafe", () => {
  it("gives another entry of the list", () => {
    const first = SAFE_TEXT.partName[0];
    const next = nextSafe("partName", first);
    expect(next).not.toBe(first);
    expect(SAFE_TEXT.partName).toContain(next);
  });
});
