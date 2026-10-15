import { contrastRatio, isHexColor } from "@g3/site-config";
import type { RolePreset } from "@g3/worker-schedule";
import type { CSSProperties } from "react";

// How a role's color looks. A preset is a tinted block with dark text, which the shared theme
// turns into a dark tint with light text in dark mode (whole class names, so Tailwind finds
// them). A custom color (#rrggbb) is drawn as it is, with black or white text, whichever reads
// better on it. The presets leave out red, which means a problem in every app.

export const PRESETS: Record<RolePreset, { block: string; swatch: string; name: string }> = {
  orange: {
    block: "bg-orange-200 text-orange-950 border-orange-300",
    swatch: "bg-orange-400",
    name: "Orange",
  },
  amber: {
    block: "bg-amber-200 text-amber-950 border-amber-300",
    swatch: "bg-amber-400",
    name: "Amber",
  },
  lime: { block: "bg-lime-200 text-lime-950 border-lime-300", swatch: "bg-lime-400", name: "Lime" },
  green: {
    block: "bg-green-200 text-green-950 border-green-300",
    swatch: "bg-green-500",
    name: "Green",
  },
  teal: { block: "bg-teal-200 text-teal-950 border-teal-300", swatch: "bg-teal-500", name: "Teal" },
  sky: { block: "bg-sky-200 text-sky-950 border-sky-300", swatch: "bg-sky-400", name: "Sky" },
  blue: { block: "bg-blue-200 text-blue-950 border-blue-300", swatch: "bg-blue-500", name: "Blue" },
  indigo: {
    block: "bg-indigo-200 text-indigo-950 border-indigo-300",
    swatch: "bg-indigo-500",
    name: "Indigo",
  },
  violet: {
    block: "bg-violet-200 text-violet-950 border-violet-300",
    swatch: "bg-violet-500",
    name: "Violet",
  },
  pink: { block: "bg-pink-200 text-pink-950 border-pink-300", swatch: "bg-pink-400", name: "Pink" },
  gray: {
    block: "bg-secondary-200 text-secondary-900 border-secondary-300",
    swatch: "bg-secondary-500",
    name: "Gray",
  },
};

export const PRESET_KEYS = Object.keys(PRESETS) as RolePreset[];

export const isPreset = (color: string): color is RolePreset => color in PRESETS;

/** A role color's look on the page: its classes, and a style for a custom color. */
export type Look = { className: string; style?: CSSProperties };

/** Text that reads on a custom color: black or white, whichever contrasts more. */
const textOn = (hex: string) =>
  contrastRatio(hex, "#000000") >= contrastRatio(hex, "#ffffff") ? "#000000" : "#ffffff";

/** A block in the role's color: a run on the grid, a tool, a role's name. */
export function roleBlock(color: string): Look {
  if (isPreset(color)) return { className: PRESETS[color].block };
  if (isHexColor(color)) {
    return {
      className: "",
      style: { backgroundColor: color, color: textOn(color), borderColor: "rgb(0 0 0 / 0.15)" },
    };
  }
  return { className: PRESETS.gray.block };
}

/** A small square of the role's color, beside its name. */
export function Swatch({ color, className = "h-3 w-3" }: { color: string; className?: string }) {
  if (isPreset(color)) {
    return (
      <span
        aria-hidden
        className={`inline-block rounded-sm ${className} ${PRESETS[color].swatch}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-block rounded-sm border border-black/15 ${className}`}
      style={{ backgroundColor: isHexColor(color) ? color : undefined }}
    />
  );
}
