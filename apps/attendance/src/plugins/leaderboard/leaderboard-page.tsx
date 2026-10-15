import { Page } from "@g3/ui";
import { AttendanceReports } from "./attendance-reports";

/** Attendance, for every member: the grid opens with the most hours first. */
export function LeaderboardPage() {
  return (
    <Page title="Leaderboard" width="wide">
      <AttendanceReports />
    </Page>
  );
}
