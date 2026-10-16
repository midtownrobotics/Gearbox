import { Button, Card, ConfirmButton, ErrorBanner, Page, TextField } from "@g3/ui";
import { useState } from "react";
import { type Operator, consoleApi, formatDate, read, send, useLoad } from "./data";

// Who can use the console. Someone who isn't an operator sees their account id when they open it;
// an operator adds them with it.

export function OperatorsPage() {
  const operators = useLoad(() => read<Operator[]>(consoleApi.operators.$get()), []);
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await operators.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Page title="Operators">
      {(error ?? operators.error) && <ErrorBanner message={error ?? operators.error ?? ""} />}
      <Card>
        <ul className="divide-y divide-line text-sm">
          {operators.data?.map((o) => (
            <li key={o.userId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className="font-medium text-secondary-900">
                {o.displayName ?? "Account not found"}
                {o.isYou && <span className="ml-2 text-xs text-secondary-500">(you)</span>}
              </span>
              <span className="text-secondary-600">{o.email}</span>
              <span className="text-secondary-500">
                {o.teamId?.replace(/^frc/, "Team ")} · since {formatDate(o.createdAt)}
              </span>
              {!o.isYou && (
                <>
                  {/* Pushes Remove to the end of the row; asking, it takes a line of its own. */}
                  <span aria-hidden className="ml-auto" />
                  <ConfirmButton
                    size="sm"
                    label="Remove"
                    question={`Remove ${o.displayName ?? o.userId} as an operator?`}
                    onConfirm={() => run(() => send("DELETE", `/operators/${o.userId}`))}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Add an operator">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await send("POST", "/operators", { userId });
              setUserId("");
            });
          }}
        >
          <TextField
            kind="label"
            required
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Their account id (shown to them on this console)"
            aria-label="Account id"
            className="max-w-md"
          />
          <Button type="submit">Add</Button>
        </form>
      </Card>
    </Page>
  );
}
