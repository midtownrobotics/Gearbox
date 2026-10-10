import { apiPath, appUrl } from "@g3/site-config";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ManageMemberPanel, type MemberSummary, SignedInPanel } from "./admin-attendance-tools";

// The attendance worker's API, reached from this page's own address (`/api/~attendance`: the
// gateway sends it to Attendance for the same team), with the same session cookie.
const ATTENDANCE_API_URL = apiPath("attendance");

/** Where the school year and sign-out limit are now: the team's App settings page. */
function AttendanceSettingsLink() {
  return (
    <section className="bg-surface border border-secondary-200 rounded-lg p-4">
      <h2 className="text-lg font-bold text-secondary-900 mb-1">School year and sign-out limit</h2>
      <p className="text-sm text-secondary-600">
        These are on your team's{" "}
        <a
          href={`${appUrl("portal")}/admin/settings`}
          className="font-semibold text-primary-600 underline"
        >
          App settings
        </a>{" "}
        page.
      </p>
    </section>
  );
}

/**
 * What admins do by hand about attendance: sign people out, adjust a member's hours or remove
 * them; the team's settings are on its App settings page. The reports are on the Leaderboard page,
 * for every member.
 */
export function AdminAttendancePage() {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Also called after every change made here, with what's showing left in place meanwhile.
  const load = useCallback(async () => {
    try {
      const res = await fetch(`${ATTENDANCE_API_URL}/admin/summary`, { credentials: "include" });
      if (!res.ok) {
        throw new Error(
          res.status === 403 ? "Admin access required." : "Failed to load attendance.",
        );
      }
      setMembers(((await res.json()) as { members: MemberSummary[] }).members);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load attendance.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full">
      <h1 className="text-3xl font-bold text-secondary-900 mb-6">Attendance Settings</h1>

      <div className="space-y-6">
        {error && <p className="text-sm text-red-700">{error}</p>}
        {!members && !error && (
          <div className="flex items-center justify-center py-16 gap-2 text-secondary-600">
            <Loader2 size={20} className="animate-spin" />
            <span>Loading attendance...</span>
          </div>
        )}
        {members && (
          <>
            <SignedInPanel members={members} onChanged={load} />
            <ManageMemberPanel members={members} onChanged={load} />
          </>
        )}
        <AttendanceSettingsLink />
      </div>
    </main>
  );
}
