import { exports } from "cloudflare:workers";
import { site } from "@g3/site-config";
import { describe, expect, it } from "vitest";

const gateway = (url: string, init?: RequestInit) => exports.default.fetch(new Request(url, init));
type Echo = {
  app: string;
  host: string;
  path: string;
  cookie: string | null;
  team: string | null;
  user: string | null;
  sessionType: string | null;
  roles: string | null;
};
const routed = async (url: string, init?: RequestInit) =>
  (await (await gateway(url, init)).json()) as Echo;

describe("gateway", () => {
  it("sends each app's address to its worker, page and /api alike", async () => {
    expect(await routed(`https://orders.${site.domain}/lists/4?x=1`)).toMatchObject({
      app: "ORDERS",
      host: `orders.${site.domain}`,
      path: "/lists/4?x=1",
    });
    expect((await routed(`https://orders.${site.domain}/api/requests`)).path).toBe("/api/requests");
    expect((await routed(`https://${site.apps.id.web}.${site.domain}/`)).app).toBe("G3ID");
    expect((await routed(`https://${site.apps.portal.web}.${site.domain}/`)).app).toBe("PORTAL");
    expect((await routed(`https://${site.apps.attendance.web}.${site.domain}/`)).app).toBe(
      "ATTENDANCE",
    );
  });

  it("answers the old api.<app> addresses at the app's /api", async () => {
    expect(
      await routed(`https://api.g3id.${site.domain}/auth/google/callback?code=abc`),
    ).toMatchObject({
      app: "G3ID",
      host: `api.g3id.${site.domain}`,
      path: "/api/auth/google/callback?code=abc",
    });
    expect((await routed(`https://api.scouting.${site.domain}/scouting/me`)).path).toBe(
      "/api/scouting/me",
    );
  });

  it("keeps the method, headers and body", async () => {
    const echoed = await routed(`https://shop.${site.domain}/api/print`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: "%PDF",
    });
    expect(echoed.app).toBe("SHOP");
  });

  it("passes other hostnames (the public site, the edge box's tunnel) on unchanged", async () => {
    for (const host of [`www.${site.domain}`, `edge-agent.${site.domain}`]) {
      expect(await routed(`https://${host}/print/printers`)).toEqual({
        app: "origin",
        host,
        path: "/print/printers",
      });
    }
  });

  it("passes on the error when nothing is behind a hostname", async () => {
    const res = await gateway(`https://dead.${site.domain}/`);
    expect(res.status).toBe(530);
  });
});

// Teams: G3ID (stubbed in vitest.config.mts) knows teams 1648 and 254, and sessions "ours" (an admin
// of 1648), "theirs" (a member of 254) and "kiosk" (a 254 kiosk PIN session).
const ours = site.team.number;
const team = (host: string) => `https://${host}.${site.domain}`;

describe("team addresses", () => {
  it("sends <number>-<app> to the app and <number> to the team's home, for that team", async () => {
    expect(await routed(`${team("254-orders")}/api/requests`)).toMatchObject({
      app: "ORDERS",
      path: "/api/requests",
      team: "frc254",
    });
    expect(await routed(`${team("254-skill-tree")}/`)).toMatchObject({
      app: "SKILL_TREE",
      team: "frc254",
    });
    expect(await routed(`${team("254")}/`)).toMatchObject({ app: "PORTAL", team: "frc254" });
    expect(await routed(`${team(`${ours}-id`)}/login`)).toMatchObject({
      app: "G3ID",
      team: `frc${ours}`,
    });
  });

  it("gives the site's own addresses its team", async () => {
    expect((await routed(`https://shop.${site.domain}/`)).team).toBe(`frc${ours}`);
    expect((await routed(`https://api.shop.${site.domain}/parts`)).team).toBe(`frc${ours}`);
  });

  it("answers 404 for a team or app that doesn't exist", async () => {
    expect((await gateway(`${team("999-orders")}/`)).status).toBe(404);
    expect((await gateway(`${team("254-nope")}/`)).status).toBe(404);
  });
});

describe("sessions and identity", () => {
  const api = (url: string, session?: string, init: RequestInit = {}) =>
    routed(url, {
      ...init,
      headers: { ...(session && { Cookie: `theme=dark; g3_session=${session}` }), ...init.headers },
    });

  it("tells the app who's signed in, for the team's own members", async () => {
    expect(await api(`https://orders.${site.domain}/api/me`, "ours")).toMatchObject({
      user: "u-ours",
      sessionType: "oauth",
      roles: "admin",
      cookie: "theme=dark; g3_session=ours",
    });
    expect(await api(`${team("254-orders")}/api/me`, "kiosk")).toMatchObject({
      user: "u-kiosk",
      sessionType: "pin",
      roles: "",
    });
  });

  it("drops another team's session, so its member is signed out here", async () => {
    expect(await api(`https://orders.${site.domain}/api/me`, "theirs")).toMatchObject({
      user: null,
      cookie: "theme=dark",
    });
    expect(await api(`${team("254-orders")}/api/me`, "ours")).toMatchObject({
      user: null,
      cookie: "theme=dark",
    });
  });

  it("leaves an unknown session for the app to reject", async () => {
    expect(await api(`https://orders.${site.domain}/api/me`, "expired")).toMatchObject({
      user: null,
      cookie: "theme=dark; g3_session=expired",
    });
  });

  it("removes identity headers a client sends", async () => {
    const echoed = await api(`https://orders.${site.domain}/api/me`, undefined, {
      headers: { "X-User-Id": "u-ours", "X-User-Roles": "admin", "X-Team-Id": "frc254" },
    });
    expect(echoed).toMatchObject({ user: null, roles: null, team: `frc${ours}` });
  });
});

describe("requests from other pages", () => {
  const from = (origin: string, url = `${team("254-orders")}/api/requests`, method = "POST") =>
    gateway(url, { method, headers: { Origin: origin } });

  it("lets the team's own pages, the site's other pages and localhost call its API", async () => {
    expect((await from(team("254-shop"))).status).toBe(200);
    expect((await from(team("254"))).status).toBe(200);
    expect(
      (await from(`https://shop.${site.domain}`, `${team(`${ours}-orders`)}/api/x`)).status,
    ).toBe(200);
    expect((await from(`https://www.${site.domain}`)).status).toBe(200);
    expect((await from("http://localhost:5184")).status).toBe(200);
  });

  it("refuses another team's pages and other sites, reads included", async () => {
    expect((await from(`https://orders.${site.domain}`)).status).toBe(403);
    expect((await from(team(`${ours}-orders`), undefined, "GET")).status).toBe(403);
    expect((await from("https://evil.example")).status).toBe(403);
  });

  it("doesn't check pages, only /api", async () => {
    expect((await from("https://evil.example", `${team("254-orders")}/`, "GET")).status).toBe(200);
  });
});

describe("calling another app's API", () => {
  it("sends /api/~<app> to that app's /api, for the page's own team", async () => {
    expect(
      await routed(`https://${site.apps.id.web}.${site.domain}/api/~attendance/leaderboard`),
    ).toMatchObject({
      app: "ATTENDANCE",
      path: "/api/leaderboard",
      team: `frc${ours}`,
    });
    expect(await routed(`${team("254")}/api/~id/users`)).toMatchObject({
      app: "G3ID",
      path: "/api/users",
      team: "frc254",
    });
  });

  it("answers 404 for an app that doesn't exist", async () => {
    expect((await gateway(`${team("254")}/api/~nope/x`)).status).toBe(404);
  });
});

describe("the platform's sign-in callback host", () => {
  it("sends id.<domain> to G3ID for no team, so the sign-in's state says which", async () => {
    const echoed = await routed(`https://id.${site.domain}/api/auth/google/callback?code=x`, {
      headers: { "X-Team-Id": "frc254", Cookie: "g3_session=theirs" },
    });
    expect(echoed).toMatchObject({
      app: "G3ID",
      path: "/api/auth/google/callback?code=x",
      team: null,
      user: null,
      cookie: "g3_session=theirs",
    });
  });
});
