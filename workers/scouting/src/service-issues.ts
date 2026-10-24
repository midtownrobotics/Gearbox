/**
 * What a service ticket's problem is. A ticket has any number of these, in this order; none means
 * the person reporting it wasn't sure. Shared by the worker's checks and Scouting's forms
 * (`@g3/worker-scouting/service-issues`). The database's own check in migration
 * `0037_service_ticket_issue_types.sql` lists the same values.
 */
export const SERVICE_ISSUE_TYPES = [
  { value: "mechanical", label: "Mechanical" },
  { value: "electrical", label: "Electrical" },
  { value: "programming", label: "Programming" },
  { value: "other", label: "Other" },
] as const;

export type ServiceIssueType = (typeof SERVICE_ISSUE_TYPES)[number]["value"];

const VALUES: readonly string[] = SERVICE_ISSUE_TYPES.map((type) => type.value);

export function isServiceIssueType(value: unknown): value is ServiceIssueType {
  return typeof value === "string" && VALUES.includes(value);
}

/** Puts a ticket's types in the list's order, so every ticket reads the same way. */
export function sortServiceIssueTypes(types: readonly ServiceIssueType[]) {
  return [...types].sort((left, right) => VALUES.indexOf(left) - VALUES.indexOf(right));
}

/** Reads `issueTypes` from a request: a list of distinct types, empty when the type isn't sure. */
export function parseServiceIssueTypes(
  value: unknown,
): { types: ServiceIssueType[] } | { error: string } {
  if (!Array.isArray(value))
    return {
      error: `issueTypes must be a list of issue types (${VALUES.join(", ")}), or an empty list when the type isn't sure.`,
    };
  const seen = new Set<string>();
  for (const item of value) {
    if (!isServiceIssueType(item))
      return {
        error: `Unknown issue type ${JSON.stringify(item)}. Choose from ${VALUES.join(", ")}.`,
      };
    if (seen.has(item)) return { error: `The issue type "${item}" is listed more than once.` };
    seen.add(item);
  }
  return { types: sortServiceIssueTypes(value as ServiceIssueType[]) };
}

/**
 * A ticket's types as a phrase for a sentence: "a mechanical issue", "a mechanical and electrical
 * issue", "an issue (type not sure)".
 */
export function describeServiceIssue(types: readonly ServiceIssueType[]) {
  if (types.length === 0) return "an issue (type not sure)";
  if (types.length === 1 && types[0] === "other") return "an issue of another kind";
  const words = sortServiceIssueTypes(types);
  const list =
    words.length === 1
      ? words[0]
      : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `${/^[aeiou]/.test(list) ? "an" : "a"} ${list} issue`;
}
