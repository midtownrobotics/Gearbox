// Colours as hue, saturation and value, for Team Appearance's accents: the light and the dark
// accent can share a hue while each keeps its own saturation and value (how bright it is), so
// each can be set against its own background.

/** Hue in degrees (0–360), saturation and value from 0 to 1. */
export type Hsv = { h: number; s: number; v: number };

export const isHexColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);

/** A `#rrggbb` colour's hue, saturation and value. Greys and black have hue 0. */
export function hexToHsv(hex: string): Hsv {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const spread = max - Math.min(r, g, b);
  let h = 0;
  if (spread > 0) {
    if (max === r) h = ((g - b) / spread + 6) % 6;
    else if (max === g) h = (b - r) / spread + 2;
    else h = (r - g) / spread + 4;
  }
  return { h: h * 60, s: max === 0 ? 0 : spread / max, v: max / 255 };
}

/** The `#rrggbb` colour (lower case) with that hue, saturation and value. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const sector = (((h % 360) + 360) % 360) / 60;
  const chroma = v * s;
  const middle = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1
      ? [chroma, middle, 0]
      : sector < 2
        ? [middle, chroma, 0]
        : sector < 3
          ? [0, chroma, middle]
          : sector < 4
            ? [0, middle, chroma]
            : sector < 5
              ? [middle, 0, chroma]
              : [chroma, 0, middle];
  const channel = (part: number) =>
    Math.round((part + v - chroma) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * `color` turned to `source`'s hue, keeping its own saturation and value. A grey or black source
 * has no hue to give, so `color` stays as it is.
 */
export function withHueOf(color: string, source: string): string {
  const from = hexToHsv(source);
  if (from.s === 0) return color.toLowerCase();
  return hsvToHex({ ...hexToHsv(color), h: from.h });
}
