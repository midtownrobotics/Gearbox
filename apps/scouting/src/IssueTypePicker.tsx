import { Chip } from "@g3/ui";
import { SERVICE_ISSUE_TYPES, type ServiceIssueType } from "@g3/worker-scouting/service-issues";
import { useId } from "react";

/** A service ticket's issue types as picked: some types, "Not sure", or nothing yet. */
export type IssueChoice = { types: ServiceIssueType[]; notSure: boolean };

export const emptyIssueChoice: IssueChoice = { types: [], notSure: false };

/** What a ticket sends as `issueTypes`, or null while nothing is picked. */
export function issueTypesToSend(choice: IssueChoice): ServiceIssueType[] | null {
  if (choice.notSure) return [];
  return choice.types.length ? choice.types : null;
}

/**
 * The issue type chips: any of the types, or Not sure. Picking Not sure clears the types, and
 * picking a type clears Not sure. `missing` shows that one is needed before sending.
 */
export function IssueTypePicker({
  choice,
  onChange,
  missing = false,
  label = "Issue type",
}: {
  choice: IssueChoice;
  /** Gets an update from the current choice, so quick taps in a row all count. */
  onChange: (update: (current: IssueChoice) => IssueChoice) => void;
  missing?: boolean;
  label?: string;
}) {
  const labelId = useId();
  const errorId = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <span id={labelId} className="text-sm font-semibold text-secondary-900">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={missing ? errorId : undefined}
        className="flex flex-wrap gap-2"
      >
        {SERVICE_ISSUE_TYPES.map((type) => {
          const selected = choice.types.includes(type.value);
          return (
            <Chip
              key={type.value}
              className="min-h-11"
              selected={selected}
              onClick={() =>
                onChange((current) => ({
                  types: current.types.includes(type.value)
                    ? current.types.filter((value) => value !== type.value)
                    : [...current.types, type.value],
                  notSure: false,
                }))
              }
            >
              {type.label}
            </Chip>
          );
        })}
        <Chip
          className="min-h-11"
          selected={choice.notSure}
          onClick={() => onChange((current) => ({ types: [], notSure: !current.notSure }))}
        >
          Not sure
        </Chip>
      </div>
      {missing && (
        <span id={errorId} role="alert" className="text-sm font-medium text-red-700">
          Choose the issue type, or Not sure.
        </span>
      )}
    </div>
  );
}
