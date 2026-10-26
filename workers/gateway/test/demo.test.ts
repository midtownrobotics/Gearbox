import { exports } from "cloudflare:workers";
import { SAFE_TEXT } from "@g3/demo";
import { site } from "@g3/site-config";
import { describe, expect, it } from "vitest";

// The public demo's team (frc9999 in the stubs, vitest.config.mts): its API is checked before
// any app sees it (src/demo.ts). The app stubs say no words of their own, so only the safe lists
// and members' names count here.

const gateway = (url: string, init?: RequestInit) => exports.default.fetch(new Request(url, init));
const demo = (app: string) =>
  `https://${site.demo.teamNumber}${app ? `-${app}` : ""}.${site.platformDomain}`;
const send = (url: string, method: string, body: unknown, ip = "203.0.113.1") =>
  gateway(url, {
    method,
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });

describe("the public demo", () => {
  it("leads demo.<platform> to the demo team's home", async () => {
    const res = await gateway(`https://demo.${site.platformDomain}/`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`${demo("")}/`);
  });

  it("passes changes made of safe text and machine values", async () => {
    const res = await send(`${demo("orders")}/api/requests`, "POST", {
      name: "Swerve module",
      reason: "Spares for competition",
      priority: "high",
      quantity: 2,
      needBy: "2026-11-01",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { app: string }).app).toBe("ORDERS");
  });

  it("refuses typed text, in the body and the query", async () => {
    const res = await send(`${demo("orders")}/api/requests`, "POST", { name: "Anything I like" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "demo" });
    const query = await send(`${demo("pit")}/api/issues?note=Anything+I+like`, "POST", {});
    expect(query.status).toBe(400);
  });

  it("refuses uploads", async () => {
    const res = await gateway(`${demo("shop")}/api/drawings/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: "%PDF",
    });
    expect(res.status).toBe(415);
  });

  it("checks a form's text, and refuses a file in one", async () => {
    const url = `${demo("scouting")}/api/scouting/scouting-forms/form_scouting/submissions`;
    const post = (form: FormData) => gateway(url, { method: "POST", body: form });
    const safe = new FormData();
    safe.set("answers", JSON.stringify({ climb: "Mid", notes: "Looks good" }));
    safe.set("teamName", "99901");
    expect((await post(safe)).status).toBe(200);
    const typed = new FormData();
    typed.set("answers", JSON.stringify({ notes: "Anything I like" }));
    expect((await post(typed)).status).toBe(400);
    const file = new FormData();
    file.set("drawing", new File(["png"], "map.png", { type: "image/png" }));
    expect((await post(file)).status).toBe(415);
  });

  it("refuses what reaches outside the demo, for any method", async () => {
    expect((await gateway(`${demo("id")}/api/slack/install`)).status).toBe(403);
    expect((await send(`${demo("")}/api/~platform/team/library/orders`, "PUT", {})).status).toBe(
      403,
    );
    expect((await send(`${demo("edge")}/api/box/key`, "POST", {})).status).toBe(403);
    const scan = `${demo("scouting")}/api/scouting/manual-schedule/extract`;
    expect((await send(scan, "POST", {})).status).toBe(403);
  });

  it("looks up only the sample links, since a lookup fetches the vendor's page", async () => {
    const lookup = (url: string, base = demo("orders"), path = "/api/lookup") =>
      gateway(`${base}${path}?url=${encodeURIComponent(url)}`);
    expect((await lookup(SAFE_TEXT.url[0])).status).toBe(200);
    expect((await lookup("https://example.com/products/anything")).status).toBe(403);
    expect(
      (await lookup("https://example.com/x", demo("inventory"), "/api/~orders/lookup")).status,
    ).toBe(403);
    expect((await gateway(`${demo("orders")}/api/lookup`)).status).toBe(403);
  });

  it("lets reading through untouched", async () => {
    const res = await gateway(`${demo("orders")}/api/requests?q=anything+at+all`);
    expect(res.status).toBe(200);
  });

  it("limits how fast one visitor makes changes", async () => {
    const statuses: number[] = [];
    // The limit is 60 changes a minute in fixed windows, so 70 can straddle two windows without
    // either going over; 130 goes over in one however the windows fall.
    for (let i = 0; i < 130; i++) {
      statuses.push((await send(`${demo("pit")}/api/lists`, "POST", {}, "198.51.100.7")).status);
    }
    expect(statuses).toContain(429);
    // Someone else isn't held up.
    expect((await send(`${demo("pit")}/api/lists`, "POST", {}, "198.51.100.8")).status).toBe(200);
  });

  it("leaves other teams' text alone", async () => {
    const res = await send(
      `https://${site.team.number}-orders.${site.platformDomain}/api/requests`,
      "POST",
      { name: "Anything I like" },
    );
    expect(res.status).toBe(200);
  });
});
