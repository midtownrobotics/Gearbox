import type { FieldValue, FieldValues, FieldView } from "@g3/worker-inventory";
import { formatDate } from "./format";
import { Field, inputClass } from "./ui";

// The team's own fields: how a value is shown, and the input for each kind of field.

/** A field's value as text, for a table cell or a search. "" when there's none. */
export function valueText(field: FieldView, value: FieldValue | undefined): string {
  if (value === undefined || value === null || value === "") return "";
  if (field.type === "checkbox") return value ? "Yes" : "";
  if (field.type === "date" && typeof value === "string") {
    const ms = Date.parse(`${value}T12:00:00`);
    return Number.isNaN(ms) ? value : formatDate(ms);
  }
  return String(value);
}

/** A field's value on a page: links are links, the rest is text. */
export function ValueView({ field, value }: { field: FieldView; value: FieldValue | undefined }) {
  const text = valueText(field, value);
  if (!text) return <span className="text-secondary-400">—</span>;
  if (field.type === "link") {
    return (
      <a
        href={text}
        target="_blank"
        rel="noreferrer"
        className="text-primary-600 hover:underline break-all"
      >
        {text}
      </a>
    );
  }
  return <span className="whitespace-pre-wrap">{text}</span>;
}

/** What a form holds while it's being filled in: text for everything but checkboxes. */
export type Draft = Record<string, string | boolean>;

export function draftOf(fields: FieldView[], values: FieldValues): Draft {
  const draft: Draft = {};
  for (const field of fields) {
    const value = values[field.id];
    draft[field.id] =
      field.type === "checkbox" ? value === true : value === undefined ? "" : String(value);
  }
  return draft;
}

/** The draft as the API takes it (null clears a value), or what's wrong with it. */
export function valuesOf(
  fields: FieldView[],
  draft: Draft,
): { values: Record<string, FieldValue | null> } | { error: string } {
  const values: Record<string, FieldValue | null> = {};
  for (const field of fields) {
    const raw = draft[field.id];
    if (field.type === "checkbox") {
      values[field.id] = raw === true ? true : null;
    } else if (typeof raw !== "string" || raw.trim() === "") {
      values[field.id] = null;
    } else if (field.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: `${field.name} must be a number.` };
      values[field.id] = n;
    } else {
      values[field.id] = raw.trim();
    }
  }
  return { values };
}

/** One input per field, in the team's order. */
export function FieldInputs({
  fields,
  draft,
  onChange,
}: { fields: FieldView[]; draft: Draft; onChange: (draft: Draft) => void }) {
  return (
    <>
      {fields.map((field) => {
        const value = draft[field.id];
        const set = (next: string | boolean) => onChange({ ...draft, [field.id]: next });
        const text = typeof value === "string" ? value : "";
        if (field.type === "checkbox") {
          return (
            <label key={field.id} className="flex items-center gap-2 text-sm text-secondary-700">
              <input
                type="checkbox"
                checked={value === true}
                onChange={(e) => set(e.target.checked)}
              />
              {field.name}
            </label>
          );
        }
        return (
          <Field key={field.id} label={field.name}>
            {field.type === "choice" ? (
              <select className={inputClass} value={text} onChange={(e) => set(e.target.value)}>
                <option value="">—</option>
                {/* A choice that was since removed stays selectable until it's changed. */}
                {text && !field.options.includes(text) && <option value={text}>{text}</option>}
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === "paragraph" ? (
              <textarea
                className={inputClass}
                rows={3}
                maxLength={4000}
                value={text}
                onChange={(e) => set(e.target.value)}
              />
            ) : (
              <input
                className={inputClass}
                type={
                  field.type === "number"
                    ? "number"
                    : field.type === "date"
                      ? "date"
                      : field.type === "link"
                        ? "url"
                        : "text"
                }
                step={field.type === "number" ? "any" : undefined}
                placeholder={field.type === "link" ? "https://…" : undefined}
                maxLength={field.type === "text" ? 200 : undefined}
                value={text}
                onChange={(e) => set(e.target.value)}
              />
            )}
          </Field>
        );
      })}
    </>
  );
}
