import { AttendanceReports } from "./attendance-reports";

/** Attendance, for every member: the grid opens with the most hours first. */
export function LeaderboardPage() {
  return (
    <main className="flex-1 px-4 py-8 max-w-6xl mx-auto w-full sm:px-6">
      <h1 className="text-5xl font-bold text-secondary-900 mb-8 text-center">Leaderboard</h1>
      <AttendanceReports />
    </main>
  );
}
