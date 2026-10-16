import { site } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { g3id } from "./helpers";

// Which sites may call the workers from a browser with the session cookie (@g3/site-config).

const allowOrigin = async (origin: string) =>
  (await g3id("/health", { headers: { Origin: origin } })).headers.get(
    "Access-Control-Allow-Origin",
  );

describe("CORS", () => {
  it("allows the platform's domain and localhost", async () => {
    for (const origin of [
      `https://${site.platformDomain}`,
      `https://${site.team.number}-shop.${site.platformDomain}`,
      "http://localhost:5174",
    ]) {
      expect(await allowOrigin(origin)).toBe(origin);
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
