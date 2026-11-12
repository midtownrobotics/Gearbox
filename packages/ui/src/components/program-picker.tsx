// SPDX-License-Identifier: AGPL-3.0-only
import { PROGRAMS, type Program, programNames } from "@g3/site-config";
import { focusRing } from "./focus";

const fullNames: Record<Program, string> = {
  frc: "FIRST Robotics Competition",
  ftc: "FIRST Tech Challenge",
};

/**
 * FRC or FTC: a team's program, as two buttons side by side. `value` null: neither chosen yet.
 * A chosen one is near-black, like a chosen chip; `outlined`, it keeps its card and gets an edge
 * in the accent color instead (the platform's own pages: find your team).
 */
export function ProgramPicker({
  value,
  onChange,
  label = "Program",
  disabled = false,
  outlined = false,
}: {
  value: Program | null;
  onChange: (program: Program) => void;
  label?: string;
  disabled?: boolean;
  outlined?: boolean;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 block text-sm font-medium text-secondary-700">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {PROGRAMS.map((program) => {
          const selected = value === program;
          return (
            <button
              key={program}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(program)}
              className={`min-w-0 rounded-lg border px-3 py-2 text-left ${focusRing} disabled:opacity-60 ${
                selected && outlined
                  ? "border-primary-500 bg-surface text-secondary-900 ring-1 ring-primary-500"
                  : selected
                    ? "border-secondary-900 bg-secondary-900 text-white"
                    : "border-secondary-300 bg-surface text-secondary-900 hover:border-secondary-500"
              }`}
            >
              <span className="block font-semibold">{programNames[program]}</span>
              <span
                className={`block text-xs ${
                  selected && !outlined ? "text-secondary-200" : "text-secondary-600"
                }`}
              >
                {fullNames[program]}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
