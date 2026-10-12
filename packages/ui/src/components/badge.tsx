import type { ReactNode } from "react";

/**
 * The colors that mean something, as a badge's fill, text and border. They are the same for every
 * team: a team's own color never stands for a problem or a status.
 */
export const tones = {
  neutral: "bg-secondary-100 text-secondary-600 border-secondary-300",
  info: "bg-sky-50 text-sky-800 border-sky-300",
  success: "bg-emerald-50 text-emerald-800 border-emerald-300",
  warning: "bg-amber-50 text-amber-800 border-amber-300",
  danger: "bg-red-50 text-red-800 border-red-300",
} as const;

/**
 * A status as a small label. Give it an icon where one helps it read without its color.
 * `colors` is one of `tones`, or fill, text and border classes for a status with a color of its
 * own.
 */
export function Badge({
  colors = tones.neutral,
  icon,
  children,
}: { colors?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${colors}`}
    >
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}
