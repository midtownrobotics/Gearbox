// SPDX-License-Identifier: AGPL-3.0-only
import { docsUrl } from "@g3/site-config";
import { Card, ErrorBanner, Loading, Page } from "@g3/ui";
import { type ReactNode, useEffect, useState } from "react";
import { type OperatorAccess, platform } from "../../lib/platform";

// Every time a Gearbox operator opened the team's data or changed it (the platform's operator log,
// GET /team/operator-access): what they did, when, and the reason they gave. Never which operator.
// One page, two lists: the team's details (which hold no member's name or email) and changes to
// the team, and its member list (with names and emails).

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
    case "view_team_details":
      return "Opened your team's details";
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
    case "change_program":
      return "Changed the team's program (FRC or FTC), moving it to its new addresses";
  }
}

function AccessList({
  kind,
  title,
  description,
  empty,
}: {
  kind: "team" | "members";
  title: string;
  description: ReactNode;
  empty: string;
}) {
  const [entries, setEntries] = useState<OperatorAccess[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    platform<OperatorAccess[]>(`/team/operator-access?kind=${kind}`)
      .then(setEntries)
      .catch((e: Error) => setError(e.message));
  }, [kind]);

  return (
    <Card title={title}>
      <div className="space-y-3">
        <p className="text-sm text-secondary-600">{description}</p>
        {error && <ErrorBanner message={error} />}
        {!entries && !error && <Loading />}
        {entries && entries.length === 0 && <p className="text-sm text-secondary-500">{empty}</p>}
        {entries && entries.length > 0 && (
          <ul className="divide-y divide-secondary-100 text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="space-y-0.5 py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap justify-between gap-x-4">
                  <span className="min-w-0 text-secondary-900">{describe(entry)}</span>
                  <span className="shrink-0 text-secondary-500">{when(entry.createdAt)}</span>
                </div>
                {entry.reason && <p className="text-secondary-600">Reason: {entry.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function OperatorAccessPage() {
  return (
    <Page
      title="Operator Access"
      description="Each time a Gearbox operator looked at your team or changed it, and the reason they gave. Kept for 12 months."
      width="narrow"
    >
      <div className="space-y-4">
        <AccessList
          kind="team"
          title="Team details"
          description={
            <>
              When an operator opened your team's details or changed your team. Your team's details
              don't include any member's name or email (
              <a
                href={`${docsUrl("portal")}/operator-access#what-operators-see`}
                className="text-primary-600 hover:underline"
              >
                what they include
              </a>
              ).
            </>
          }
          empty="No operator has opened your team's details."
        />
        <AccessList
          kind="members"
          title="Member list"
          description="When an operator opened your team's member list, which shows your members' names and emails."
          empty="No operator has opened your team's member list."
        />
      </div>
    </Page>
  );
}
