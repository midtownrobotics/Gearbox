import { Button, Dialog, ErrorBanner, Field, TextField } from "@g3/ui";
import { type FormEvent, type ReactNode, useState } from "react";

// Questions asked in a pop-up before something happens. A delete button that has room to ask in
// its own row uses `ConfirmButton` from @g3/ui; these are for a button in a table row, a yes that
// isn't a delete, and an answer that has to be typed.

/** A yes-or-no question. `children` is the question. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  keepLabel = "Cancel",
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** The button that changes nothing, named for what stays where that's clearer. */
  keepLabel?: string;
  /** Red, for something that deletes or can't be undone. */
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="text-sm text-secondary-600">{children}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {keepLabel}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * One typed answer (a reason, an amount). `onSubmit` gets what was typed; when it returns a
 * message, the answer can't be used and the message is shown.
 */
export function AnswerDialog({
  title,
  children,
  label,
  initial = "",
  multiline = false,
  inputMode,
  confirmLabel,
  danger = false,
  onSubmit,
  onClose,
}: {
  title: string;
  /** A sentence above the field on what is about to happen. */
  children?: ReactNode;
  label: string;
  initial?: string;
  /** A few lines (a reason), not one (an amount). */
  multiline?: boolean;
  inputMode?: "decimal" | "numeric" | "text";
  confirmLabel: string;
  danger?: boolean;
  onSubmit: (answer: string) => string | undefined;
  onClose: () => void;
}) {
  const [answer, setAnswer] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(onSubmit(answer) ?? null);
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {children && <p className="text-sm text-secondary-600">{children}</p>}
        <Field label={label}>
          {multiline ? (
            <TextField
              multiline
              kind="note"
              className="min-h-20"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              maxLength={1000}
              autoFocus
            />
          ) : (
            <TextField
              typeable
              inputMode={inputMode}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        {problem && <ErrorBanner message={problem} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant={danger ? "danger" : "primary"}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
