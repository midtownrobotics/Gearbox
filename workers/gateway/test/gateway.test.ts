import { exports } from "cloudflare:workers";
import { site } from "@g3/site-config";
import { describe, expect, it } from "vitest";

const gateway = (url: string, init?: RequestInit) => exports.default.fetch(new Request(url, init));
const routed = async (url: string, init?: RequestInit) =>
  (await (await gateway(url, init)).json()) as { app: string; host: string; path: string };

describe("gateway", () => {
  it("sends each app's address to its worker, page and /api alike", async () => {
    expect(await routed(`https://orders.${site.domain}/lists/4?x=1`)).toEqual({
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
    expect(await routed(`https://api.g3id.${site.domain}/auth/google/callback?code=abc`)).toEqual({
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
