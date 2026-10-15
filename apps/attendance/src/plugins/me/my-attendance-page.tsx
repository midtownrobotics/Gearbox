import { Button, Card, ErrorBanner, Loading, Page, Stat } from "@g3/ui";
import { useEffect, useMemo, useState } from "react";
import { API } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import type { ReportData, ReportSession } from "../leaderboard/attendance-report";
import { formatHours } from "../leaderboard/attendance-report";
import { mySummary, ordinal } from "./my-attendance";

/** How many visits show before "Show all". */
const FIRST_VISITS = 20;

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** What a visit counted for, in words. */
function visitResult(visit: ReportSession): { text: string; problem?: boolean } {
  const hours = formatHours(visit.ms / 3_600_000);
  switch (visit.kind) {
    case "completed":
      return { text: hours };
    case "open":
      return { text: `Signed in now · ${hours} so far` };
    case "missed":
      return { text: "No sign-out, so no hours", problem: true };
    case "adjustment":
      return { text: `${visit.ms >= 0 ? "+" : "−"}${formatHours(Math.abs(visit.ms) / 3_600_000)}` };
  }
}

/** The signed-in member's own attendance this school year. */
export function MyAttendancePage() {
  const user = useAuthUser();
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/report`, { credentials: "include" });
        if (!res.ok) throw new Error();
        setData((await res.json()) as ReportData);
      } catch {
        setError("Couldn't load your attendance.");
      }
    })();
  }, []);

  const summary = useMemo(() => data && mySummary(data, user.id), [data, user.id]);

  return (
    <Page title="My Attendance" width="narrow">
      {error && <ErrorBanner message={error} />}
      {!data && !error && <Loading />}
      {data && !summary && (
        <p className="text-sm text-secondary-600">
          You haven't signed in this school year. Scan the sign-in QR code in the shop when you
          arrive.
        </p>
      )}
      {summary && (
        <>
          {summary.signedInSince && (
            <p className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
              You're signed in, since {timeFormat.format(summary.signedInSince)}. Scan the sign-out
              code when you leave.
            </p>
          )}
          <Card title={`School year ${summary.year}`}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
              <Stat
                label="Hours"
                value={formatHours(summary.totalHours)}
                hint={`Team average ${formatHours(summary.teamAverageHours)}`}
              />
              <Stat
                label="Place"
                value={ordinal(summary.rank)}
                hint={`Of ${summary.of} on the Leaderboard`}
              />
              <Stat
                label="Meetings"
                value={`${summary.attended} of ${summary.meetingDays}`}
                hint={`${Math.round((summary.attended / Math.max(1, summary.meetingDays)) * 100)}% of meeting days`}
              />
              <Stat label="Per meeting" value={formatHours(summary.hoursPerMeeting)} />
              <Stat
                label="In a row"
                value={summary.streak}
                hint={summary.streak === 1 ? "Meeting day" : "Meeting days"}
              />
              <Stat label="Last 30 days" value={formatHours(summary.hoursLast30Days)} />
            </div>
          </Card>
          {summary.missedSignOuts > 0 && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {summary.missedSignOuts === 1
                ? "One visit had no sign-out, so it counted for no hours."
                : `${summary.missedSignOuts} visits had no sign-out, so they counted for no hours.`}{" "}
              Scan the sign-out code when you leave, or ask an admin to add the hours.
            </p>
          )}
          <Card title="Visits">
            <ul className="divide-y divide-secondary-200">
              {(showAll ? summary.visits : summary.visits.slice(0, FIRST_VISITS)).map((visit) => {
                const result = visitResult(visit);
                const signIn = new Date(visit.signIn);
                return (
                  <li
                    key={`${visit.signIn}-${visit.kind}`}
                    className="flex items-baseline justify-between gap-4 py-2 text-sm first:pt-0 last:pb-0"
                  >
                    <span className="text-secondary-900">
                      {dateFormat.format(signIn)}
                      <span className="ml-2 text-secondary-500">
                        {visit.kind === "adjustment"
                          ? "Changed by an admin"
                          : timeFormat.format(signIn)}
                      </span>
                    </span>
                    <span
                      className={
                        result.problem
                          ? "text-right text-red-700"
                          : "text-right font-medium text-secondary-900"
                      }
                    >
                      {result.text}
                    </span>
                  </li>
                );
              })}
            </ul>
            {!showAll && summary.visits.length > FIRST_VISITS && (
              <div className="mt-4">
                <Button variant="secondary" size="sm" onClick={() => setShowAll(true)}>
                  Show all {summary.visits.length}
                </Button>
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
