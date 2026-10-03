import { AttendanceLeaderboard } from "./attendance-leaderboard";

export function LeaderboardPage() {
  return (
    <main className="flex-1 px-6 py-8 max-w-lg mx-auto w-full">
      <h1 className="text-5xl font-bold text-secondary-900 mb-8 text-center">Leaderboard</h1>
      <AttendanceLeaderboard />
    </main>
  );
}
