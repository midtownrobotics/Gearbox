import { apiPath } from "@g3/site-config";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ManageMemberPanel, type MemberSummary, SignedInPanel } from "./admin-attendance-tools";

// The attendance worker's API, reached from this page's own address (`/api/~attendance`: the
// gateway sends it to Attendance for the same team), with the same session cookie.
const ATTENDANCE_API_URL = apiPath("attendance");

type AttendanceSettings = {
  schoolYearStartMonth: number;
  schoolYearStartDay: number;
  autoSignOutHours: number;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The team's attendance settings: when its school year starts, and the auto sign-out limit. */
function AttendanceSettingsCard({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<AttendanceSettings | null>(null);
  const [saved, setSaved] = useState<AttendanceSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${ATTENDANCE_API_URL}/admin/settings`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as AttendanceSettings;
        setSettings(data);
        setSaved(data);
      } catch {
        setError("Couldn't load attendance settings.");
      }
    })();
  }, []);

  if (!settings) {
    return error ? <p className="text-red-700 text-sm">{error}</p> : null;
  }
  const changed = JSON.stringify(settings) !== JSON.stringify(saved);
  const update = (patch: Partial<AttendanceSettings>) => {
    setSettings({ ...settings, ...patch });
    setStatus("idle");
  };

  async function save() {
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch(`${ATTENDANCE_API_URL}/admin/settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = (await res.json().catch(() => ({}))) as AttendanceSettings & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't save the settings.");
      setSaved(data);
      setSettings(data);
      setStatus("saved");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the settings.");
      setStatus("idle");
    }
  }

  const fieldClass =
    "rounded-lg bg-surface border border-secondary-300 px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:border-primary-500";
  return (
    <section className="bg-surface border border-secondary-200 rounded-lg p-4">
      <h2 className="text-lg font-bold text-secondary-900 mb-1">School year and sign-out limit</h2>
      <p className="text-sm text-secondary-600 mb-4">
        Hours count per school year. A session left open past the auto sign-out limit is closed and
        doesn't count.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm text-secondary-700">
          <span className="block mb-1">School year starts</span>
          <span className="flex gap-2">
            <select
              value={settings.schoolYearStartMonth}
              onChange={(e) => update({ schoolYearStartMonth: Number(e.target.value) })}
              className={fieldClass}
              aria-label="School year start month"
            >
              {MONTHS.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={31}
              value={settings.schoolYearStartDay}
              onChange={(e) => update({ schoolYearStartDay: Number(e.target.value) })}
              className={`${fieldClass} w-20`}
              aria-label="School year start day"
            />
          </span>
        </label>
        <label className="text-sm text-secondary-700">
          <span className="block mb-1">Auto sign-out after (hours)</span>
          <input
            type="number"
            min={1}
            max={24}
            value={settings.autoSignOutHours}
            onChange={(e) => update({ autoSignOutHours: Number(e.target.value) })}
            className={`${fieldClass} w-24`}
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={!changed || status === "saving"}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" && <Loader2 size={14} className="animate-spin" />}
          {status === "saved" && !changed ? "Saved" : "Save"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}

/**
 * What admins do by hand about attendance: sign people out, adjust a member's hours or remove
 * them, and the team's settings. The reports are on the Leaderboard page, for every member.
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
        <AttendanceSettingsCard onSaved={load} />
      </div>
    </main>
  );
}
