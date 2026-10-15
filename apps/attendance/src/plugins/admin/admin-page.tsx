import { Button, Card, ErrorBanner, Loading, Page, inputClass } from "@g3/ui";
import { useCallback, useEffect, useState } from "react";
import { API } from "../../shared/api";
import { ManageMemberPanel, type MemberSummary, SignedInPanel } from "./admin-tools";

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
        const res = await fetch(`${API}/admin/settings`, {
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
      const res = await fetch(`${API}/admin/settings`, {
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

  const fieldClass = `${inputClass} !w-auto`;
  return (
    <Card title="School year and sign-out limit">
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
              className={`${inputClass} !w-20`}
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
            className={`${inputClass} !w-24`}
          />
        </label>
        <Button onClick={save} disabled={!changed || status === "saving"}>
          {status === "saving" ? "Saving…" : status === "saved" && !changed ? "Saved" : "Save"}
        </Button>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
    </Card>
  );
}

/**
 * What admins do by hand about attendance: sign people out, adjust a member's hours or remove
 * them, and the team's settings. The reports are on the Leaderboard page, for every member.
 */
export function AdminPage() {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Also called after every change made here, with what's showing left in place meanwhile.
  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/summary`, { credentials: "include" });
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
    <Page title="Admin" width="narrow">
      {error && <ErrorBanner message={error} />}
      {!members && !error && <Loading />}
      {members && (
        <>
          <SignedInPanel members={members} onChanged={load} />
          <ManageMemberPanel members={members} onChanged={load} />
        </>
      )}
      <AttendanceSettingsCard onSaved={load} />
    </Page>
  );
}
