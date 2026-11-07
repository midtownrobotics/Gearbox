// SPDX-License-Identifier: AGPL-3.0-only
import { exports } from "cloudflare:workers";
import { site } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { g3id } from "./helpers";

// Which sites may call the workers from a browser with the session cookie (@g3/site-config).

const allowOrigin = async (origin: string) =>
  (await g3id("/health", { headers: { Origin: origin } })).headers.get(
    "Access-Control-Allow-Origin",
  );

/** The same, for a request that came in on a development machine's address. */
const allowOriginLocally = async (host: string, origin: string) =>
  (
    await exports.default.fetch(
      new Request(`http://${host}/health`, { headers: { Origin: origin } }),
    )
  ).headers.get("Access-Control-Allow-Origin");

describe("CORS", () => {
  it("allows the platform's domain", async () => {
    for (const origin of [
      `https://${site.platformDomain}`,
      `https://${site.team.number}-shop.${site.platformDomain}`,
    ]) {
      expect(await allowOrigin(origin)).toBe(origin);
    }
  });

  it("allows localhost only on a development machine", async () => {
    expect(await allowOrigin("http://localhost:5174")).toBeNull();
    expect(await allowOrigin("http://127.0.0.1:5174")).toBeNull();
    for (const host of ["localhost:8787", "127.0.0.1:8787", "1648-id.gearbox.localhost:8796"]) {
      expect(await allowOriginLocally(host, "http://localhost:5174")).toBe("http://localhost:5174");
    }
  });

  it("refuses anything else, including *.pages.dev previews and look-alike domains", async () => {
    for (const origin of [
      "https://evil.pages.dev",
      `https://evil${site.platformDomain}`,
      `http://1648-shop.${site.platformDomain}`,
      // G3's old domain, retired.
      `https://shop.${site.domain}`,
      "https://example.com",
    ]) {
      expect(await allowOrigin(origin)).toBeNull();
    }
  });
});
