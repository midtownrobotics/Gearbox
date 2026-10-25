import { exports } from "cloudflare:workers";
import { builtInBrandColor, site } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { recolorPixels } from "../src/icons";
import { decodePng, encodePng } from "../src/png";

const gateway = (url: string) => exports.default.fetch(new Request(url));
const team = (host: string) => `https://${host}.${site.platformDomain}`;

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

describe("recoloring", () => {
  it("swaps the accent and its mixes with black and white, and keeps the rest", () => {
    const pixels = {
      width: 5,
      height: 1,
      channels: 3 as const,
      // accent, white, black, half accent on black, half accent on white
      data: new Uint8Array([163, 32, 53, 255, 255, 255, 0, 0, 0, 82, 16, 27, 209, 144, 154]),
    };
    const out = recolorPixels(pixels, "#1f6feb").data;
    const at = (i: number) => hex(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    expect(at(0)).toBe("#1f6feb");
    expect(at(1)).toBe("#ffffff");
    expect(at(2)).toBe("#000000");
    expect(at(3)).toBe("#103876");
    expect(at(4)).toBe("#8fb7f5");
  });

  it("reads back the PNG it writes", async () => {
    const pixels = { width: 2, height: 2, channels: 4 as const, data: new Uint8Array(16).fill(7) };
    const decoded = await decodePng(await encodePng(pixels));
    expect(decoded?.pixels).toMatchObject({ width: 2, height: 2, channels: 4 });
    expect([...(decoded?.pixels.data ?? [])]).toEqual([...pixels.data]);
  });
});

describe("installed apps' icons", () => {
  it("names the team's color on the manifest's icons and draws them in it", async () => {
    const res = await gateway(`${team("4242-orders")}/manifest.webmanifest`);
    const manifest = (await res.json()) as { icons: { src: string }[] };
    expect(manifest.icons.map((icon) => icon.src)).toContain("/icon-192.png?v=1f6feb");

    const icon = await gateway(`${team("4242-orders")}/icon-192.png?v=1f6feb`);
    expect(icon.headers.get("Content-Type")).toBe("image/png");
    const decoded = await decodePng(new Uint8Array(await icon.arrayBuffer()));
    const colors = new Set<string>();
    const { data, channels } = decoded?.pixels ?? { data: new Uint8Array(), channels: 4 };
    for (let i = 0; i < data.length; i += channels)
      colors.add(hex(data[i], data[i + 1], data[i + 2]));
    expect(colors).toContain("#1f6feb");
    expect(colors).not.toContain(builtInBrandColor);
  });

  it("leaves them as they are for a team on the built-in color", async () => {
    const res = await gateway(`${team(`${site.team.number}-orders`)}/manifest.webmanifest`);
    const manifest = (await res.json()) as { icons: { src: string }[] };
    expect(manifest.icons.map((icon) => icon.src)).toContain("/icon-192.png");
  });
});
