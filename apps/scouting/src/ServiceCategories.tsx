export const SERVICE_CATEGORIES = [
  ["mechanical", "Mechanical"],
  ["electrical", "Electrical"],
  ["programming", "Programming"],
  ["other", "Other / Not sure"],
] as const;

export function ServiceCategories({
  value,
  onChange,
}: { value: string[]; onChange(value: string[]): void }) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-semibold">
        Issue categories{" "}
        <span className="font-normal text-secondary-500">(select all that apply)</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {SERVICE_CATEGORIES.map(([key, label]) => (
          <label
            key={key}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50"
          >
            <input
              type="checkbox"
              checked={value.includes(key)}
              onChange={(event) =>
                onChange(
                  event.target.checked ? [...value, key] : value.filter((item) => item !== key),
                )
              }
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
