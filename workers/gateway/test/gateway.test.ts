import { exports } from "cloudflare:workers";
import { site } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { toHttps } from "../src/index";

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
    expect(await routed(`${team(`${ours}-orders`)}/lists/4?x=1`)).toMatchObject({
      app: "ORDERS",
      host: `${ours}-orders.${site.platformDomain}`,
      path: "/lists/4?x=1",
    });
    expect((await routed(`${team(`${ours}-orders`)}/api/requests`)).path).toBe("/api/requests");
    expect((await routed(`${team(`${ours}-id`)}/`)).app).toBe("G3ID");
    expect((await routed(`${team(`${ours}`)}/`)).app).toBe("PORTAL");
    expect((await routed(`${team(`${ours}-attendance`)}/`)).app).toBe("ATTENDANCE");
  });

  it("answers the retired api.<app> addresses with the app's address to use instead", async () => {
    const res = await gateway(`https://api.g3id.${site.domain}/auth/google/callback?code=abc`);
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ use: `${team(`${ours}-id`)}/api` });
    expect((await gateway(`https://api.scouting.${site.domain}/scouting/me`)).status).toBe(410);
    // A hostname that merely starts with "api." still goes where its DNS points.
    expect(await routed(`https://api.example.${site.domain}/x`)).toMatchObject({ app: "origin" });
  });

  it("keeps the method, headers and body", async () => {
    const echoed = await routed(`${team(`${ours}-shop`)}/api/print`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: "%PDF",
    });
    expect(echoed.app).toBe("SHOP");
  });

  it("passes other hostnames (the public site, the edge box's tunnel) on unchanged", async () => {
    for (const host of [`www.${site.domain}`, `edge-agent.${site.domain}`]) {
      expect(await routed(`https://${host}/print/printers`)).toMatchObject({
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
const team = (host: string) => `https://${host}.${site.platformDomain}`;

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

  it("answers G3's old addresses on its own domain with 410 Gone and the new address", async () => {
    const page = await gateway(`https://shop.${site.domain}/parts`, {
      headers: { Accept: "text/html" },
    });
    expect(page.status).toBe(410);
    expect(await page.text()).toContain(team(`${ours}-shop`));
    for (const host of [
      `id.${site.domain}`,
      `admin.${site.domain}`,
      `${site.apps.id.web}.${site.domain}`,
    ]) {
      expect((await gateway(`https://${host}/`)).status).toBe(410);
    }
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
    expect(await api(`${team(`${ours}-orders`)}/api/me`, "ours")).toMatchObject({
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
    expect(await api(`${team(`${ours}-orders`)}/api/me`, "theirs")).toMatchObject({
      user: null,
      cookie: "theme=dark",
    });
    expect(await api(`${team("254-orders")}/api/me`, "ours")).toMatchObject({
      user: null,
      cookie: "theme=dark",
    });
  });

  it("leaves an unknown session for the app to reject", async () => {
    expect(await api(`${team(`${ours}-orders`)}/api/me`, "expired")).toMatchObject({
      user: null,
      cookie: "theme=dark; g3_session=expired",
    });
  });

  it("removes identity headers a client sends", async () => {
    const echoed = await api(`${team(`${ours}-orders`)}/api/me`, undefined, {
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
    expect((await from(team(`${ours}-shop`), `${team(`${ours}-orders`)}/api/x`)).status).toBe(200);
    expect((await from(`https://www.${site.platformDomain}`)).status).toBe(200);
    expect((await from("http://localhost:5184")).status).toBe(200);
  });

  it("refuses another team's pages and other sites, reads included", async () => {
    expect((await from(team(`${ours}-orders`))).status).toBe(403);
    // G3's old domain is no longer one of ours.
    expect((await from(`https://www.${site.domain}`)).status).toBe(403);
    expect((await from(team(`${ours}-orders`), undefined, "GET")).status).toBe(403);
    expect((await from("https://evil.example")).status).toBe(403);
  });

  it("says why: another team's page, or a page that isn't ours", async () => {
    expect(await (await from(team(`${ours}-orders`))).json()).toEqual({
      error: "Requests from another team's pages aren't allowed.",
    });
    expect(await (await from(`http://${site.platformDomain}`)).json()).toEqual({
      error: "Requests from this page aren't allowed.",
    });
  });

  it("doesn't check pages, only /api", async () => {
    expect((await from("https://evil.example", `${team("254-orders")}/`, "GET")).status).toBe(200);
  });
});

describe("https", () => {
  // The test runner hands the worker every request as https, so toHttps is tested on its own; in
  // production the worker sees the scheme the visitor used.
  it("sends http to https, keeping the path and query", () => {
    for (const url of [
      `http://${site.platformDomain}/signup?id=1`,
      `http://${ours}-orders.${site.platformDomain}/api/requests`,
      `http://254-orders.${site.platformDomain}/lists`,
    ]) {
      const res = toHttps(new URL(url));
      expect(res?.status).toBe(308);
      expect(res?.headers.get("Location")).toBe(url.replace("http://", "https://"));
    }
    expect(toHttps(new URL(`https://${site.platformDomain}/signup`))).toBeNull();
  });
});

describe("calling another app's API", () => {
  it("sends /api/~<app> to that app's /api, for the page's own team", async () => {
    expect(await routed(`${team(`${ours}-id`)}/api/~attendance/leaderboard`)).toMatchObject({
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
    const echoed = await routed(
      `https://id.${site.platformDomain}/api/auth/google/callback?code=x`,
      {
        headers: { "X-Team-Id": "frc254", Cookie: "g3_session=theirs" },
      },
    );
    expect(echoed).toMatchObject({
      app: "G3ID",
      path: "/api/auth/google/callback?code=x",
      team: null,
      user: null,
      cookie: "g3_session=theirs",
    });
  });
});

describe("the platform", () => {
  it("serves the platform's own domain, and www, from the platform worker", async () => {
    expect(await routed(`https://${site.platformDomain}/signup`)).toMatchObject({
      app: "PLATFORM",
      path: "/signup",
      team: null,
    });
    expect((await routed(`https://www.${site.platformDomain}/`)).app).toBe("PLATFORM");
  });

  it("serves the operators' console on admin.<platform>, for no team", async () => {
    expect(
      await routed(`https://admin.${site.platformDomain}/api/console/me`, {
        headers: { Cookie: "g3_session=theirs" },
      }),
    ).toMatchObject({ app: "PLATFORM", team: null, user: null, cookie: "g3_session=theirs" });
  });

  it("answers id.<platform> for sign-in callbacks too", async () => {
    expect(
      await routed(`https://id.${site.platformDomain}/api/auth/google/callback`),
    ).toMatchObject({
      app: "G3ID",
      team: null,
    });
  });

  it("only uses team-number addresses on the platform's domain", async () => {
    const res = await gateway(`https://254-orders.${site.domain}/`);
    expect(await res.json()).toMatchObject({ app: "origin" });
  });

  it("never answers workers' internal routes", async () => {
    for (const url of [
      `${team(`${ours}-id`)}/api/internal/teams`,
      `${team("254")}/api/~id/internal/teams`,
      `https://${site.platformDomain}/api/internal/x`,
    ]) {
      expect((await gateway(url, { method: "POST" })).status).toBe(404);
    }
  });
});

describe("local dev (gearbox.localhost on the gateway's dev port)", () => {
  const dev = (host: string, path = "/", init?: RequestInit) =>
    gateway(`http://${host}:8796${path}`, init);
  const body = async (res: Response) => (await res.json()) as Echo & { port: string };

  it("serves the platform and team pages from the apps' Vite dev servers", async () => {
    expect(await body(await dev("gearbox.localhost", "/signup"))).toMatchObject({
      app: "origin",
      host: "localhost",
      port: "5185",
      path: "/signup",
    });
    expect(await body(await dev(`${ours}-id.gearbox.localhost`, "/login"))).toMatchObject({
      port: "5173",
      path: "/login",
    });
    expect(await body(await dev("254-orders.gearbox.localhost", "/lists"))).toMatchObject({
      port: "5184",
    });
    // Plain localhost is the platform too.
    expect(await body(await dev("localhost", "/"))).toMatchObject({ port: "5185" });
  });

  it("sends /api to the app's worker, for the team the address names", async () => {
    expect(await body(await dev("254-orders.gearbox.localhost", "/api/requests"))).toMatchObject({
      app: "ORDERS",
      path: "/api/requests",
      team: "frc254",
    });
    expect(await body(await dev(`${ours}-shop.gearbox.localhost`, "/api/parts"))).toMatchObject({
      app: "SHOP",
      team: `frc${ours}`,
    });
    expect((await dev("999-orders.gearbox.localhost", "/api/x")).status).toBe(404);
  });

  it("stays on http and checks Origins as the addresses they stand for", async () => {
    expect((await dev("254-orders.gearbox.localhost")).status).not.toBe(308);
    const from = (origin: string) =>
      dev("254-orders.gearbox.localhost", "/api/requests", {
        method: "POST",
        headers: { Origin: origin },
      });
    expect((await from("http://254-shop.gearbox.localhost:8796")).status).toBe(200);
    expect((await from(`http://${ours}-orders.gearbox.localhost:8796`)).status).toBe(403);
  });
});
