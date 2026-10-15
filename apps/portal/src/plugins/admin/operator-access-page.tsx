import { Card, ErrorBanner, Loading, Page } from "@g3/ui";
import { useEffect, useState } from "react";
import { type OperatorAccess, platform } from "../../lib/platform";

// Every time a Gearbox operator opened the team's data or changed it (the platform's operator log,
// GET /team/operator-access): what they did, when, and the reason they gave. Never which operator.

const when = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function describe(entry: OperatorAccess): string {
  switch (entry.action) {
    case "view_team":
      return "Opened your team's member list";
    case "transfer_owner":
      return entry.to
        ? `Handed ownership of the team${entry.from ? ` from ${entry.from}` : ""} to ${entry.to}`
        : "Handed ownership of the team to another member";
    case "suspend_team":
      return "Suspended the team";
    case "reactivate_team":
      return "Reactivated the team";
    case "renumber_team":
      return "Changed the team's number";
  }
}

export function OperatorAccessPage() {
  const [entries, setEntries] = useState<OperatorAccess[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    platform<OperatorAccess[]>("/team/operator-access")
      .then(setEntries)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <Page
      title="Operator Access"
      description="Each time a Gearbox operator opened your team's information or changed your team, and why. Kept for 12 months."
      width="narrow"
    >
      {error && <ErrorBanner message={error} />}
      {!entries && !error && <Loading />}
      {entries && entries.length === 0 && (
        <p className="text-sm text-secondary-600">
          No operator has opened your team's information.
        </p>
      )}
      {entries && entries.length > 0 && (
        <Card>
          <ul className="divide-y divide-secondary-100 text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="space-y-0.5 py-2 first:pt-0 last:pb-0">
                <div className="flex justify-between gap-4">
                  <span className="text-secondary-900">{describe(entry)}</span>
                  <span className="shrink-0 text-secondary-500">{when(entry.createdAt)}</span>
                </div>
                {entry.reason && <p className="text-secondary-600">Reason: {entry.reason}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}
