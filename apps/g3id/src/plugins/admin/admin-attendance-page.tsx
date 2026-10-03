import { Loader2, LogOut, Minus, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

// The attendance worker lives on its own subdomain (api.attendance.<domain>)
// but shares the g3id session cookie (set on the team's root domain), so
// a plain fetch with credentials works the same way api.ts's typed client does for
// g3id's own routes.
const ATTENDANCE_API_URL = import.meta.env.VITE_ATTENDANCE_API_URL ?? "";

type MemberSummary = {
  id: string;
  displayName: string;
  email: string;
  signedIn: boolean;
  lastSignIn: string | null;
  totalHours: number;
};

function relativeDate(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function AdminAttendancePage() {
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [year, setYear] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hours, setHours] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${ATTENDANCE_API_URL}/admin/summary`, {
          credentials: "include",
        });
        if (!res.ok) {
          setError(res.status === 403 ? "Admin access required." : "Failed to load attendance.");
          return;
        }
        const data = (await res.json()) as { year: string; members: MemberSummary[] };
        setMembers(data.members);
        setYear(data.year);
      } catch {
        setError("Failed to load attendance.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.displayName.toLowerCase().includes(q));
  }, [members, search]);

  const signedInCount = members.filter((m) => m.signedIn).length;

  async function postAction(
    member: MemberSummary,
    action: "signout" | "add-hours",
    hourDirection: 1 | -1 = 1,
  ) {
    const hourAction = hourDirection === 1 ? "add" : "subtract";
    const actionKey = `${member.id}:${action === "add-hours" ? hourAction : action}`;
    const parsedHours = Number(hours[member.id]);
    if (action === "add-hours" && (!Number.isFinite(parsedHours) || parsedHours <= 0)) {
      setActionError(`Enter a positive number of hours for ${member.displayName}.`);
      return;
    }
    if (
      action === "add-hours" &&
      !window.confirm(
        `${hourDirection === 1 ? "Add" : "Subtract"} ${parsedHours} hours ${hourDirection === 1 ? "to" : "from"} ${member.displayName}'s yearly total?`,
      )
    ) {
      return;
    }

    setSaving(actionKey);
    setActionError(null);
    try {
      const res = await fetch(
        `${ATTENDANCE_API_URL}/admin/members/${encodeURIComponent(member.id)}/${action}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body:
            action === "add-hours"
              ? JSON.stringify({ hours: parsedHours * hourDirection })
              : undefined,
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string; totalHours?: number };
      if (!res.ok) throw new Error(data.error ?? "Attendance update failed.");

      setMembers((current) =>
        current.map((item) =>
          item.id === member.id
            ? {
                ...item,
                signedIn: action === "signout" ? false : item.signedIn,
                totalHours: typeof data.totalHours === "number" ? data.totalHours : item.totalHours,
              }
            : item,
        ),
      );
      if (action === "add-hours") {
        setHours((current) => ({ ...current, [member.id]: "" }));
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Attendance update failed.");
    } finally {
      setSaving(null);
    }
  }

  async function removeMember(member: MemberSummary) {
    if (
      !window.confirm(
        `Permanently remove ${member.displayName} and all of their attendance history? This cannot be undone.`,
      )
    ) {
      return;
    }

    setSaving(`${member.id}:remove`);
    setActionError(null);
    try {
      const res = await fetch(
        `${ATTENDANCE_API_URL}/admin/members/${encodeURIComponent(member.id)}`,
        { method: "DELETE", credentials: "include" },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Unable to remove attendance member.");
      setMembers((current) => current.filter((item) => item.id !== member.id));
      setHours((current) => {
        const next = { ...current };
        delete next[member.id];
        return next;
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to remove attendance member.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full">
      <div className="flex items-baseline justify-between mb-8">
        <h1 className="text-3xl font-bold text-secondary-900">Attendance Summary</h1>
        <span className="text-sm text-secondary-600">Total Hours {year}</span>
      </div>

      {!loading && !error && (
        <p className="text-sm text-secondary-600 mb-4">
          {signedInCount} of {members.length} members currently signed in
        </p>
      )}

      <div className="relative mb-6">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary-500" />
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 rounded-lg bg-white border border-secondary-300 text-secondary-900 placeholder-secondary-400 focus:outline-none focus:border-primary-500"
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 gap-2 text-secondary-600">
          <Loader2 size={20} className="animate-spin" />
          <span>Loading attendance...</span>
        </div>
      )}

      {!loading && error && <p className="text-primary-500 text-sm">{error}</p>}

      {!loading && !error && actionError && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-secondary-600 text-sm">No members found.</p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="bg-white border border-secondary-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-left text-secondary-600">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last Sign-In</th>
                <th className="px-4 py-3 font-medium text-right">Total Hours {year}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} className="border-b border-secondary-200 last:border-0">
                  <td className="px-4 py-3 text-secondary-900 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{m.displayName}</span>
                      {m.signedIn && (
                        <button
                          type="button"
                          onClick={() => postAction(m, "signout")}
                          disabled={saving !== null}
                          className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Sign out ${m.displayName}`}
                        >
                          {saving === `${m.id}:signout` ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <LogOut size={12} />
                          )}
                          Sign out
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeMember(m)}
                        disabled={saving !== null}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-secondary-500 transition-colors hover:bg-red-100 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Remove ${m.displayName} from attendance`}
                      >
                        {saving === `${m.id}:remove` ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Trash2 size={12} />
                        )}
                        Remove
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        m.signedIn
                          ? "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200"
                          : "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary-100 text-secondary-600 border border-secondary-200"
                      }
                    >
                      {m.signedIn ? "Signed In" : "Signed Out"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-secondary-600">{relativeDate(m.lastSignIn)}</td>
                  <td className="px-4 py-3 text-secondary-900">
                    <div className="flex items-center justify-end gap-2">
                      <span className="min-w-14 text-right font-mono">
                        {m.totalHours.toFixed(1)}h
                      </span>
                      <div className="flex items-center overflow-hidden rounded-md border border-secondary-300 bg-white focus-within:border-primary-500">
                        <input
                          type="number"
                          min="0.1"
                          max="1000"
                          step="0.1"
                          inputMode="decimal"
                          aria-label={`Hours to adjust for ${m.displayName}`}
                          placeholder="Hours"
                          value={hours[m.id] ?? ""}
                          onChange={(event) =>
                            setHours((current) => ({ ...current, [m.id]: event.target.value }))
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") postAction(m, "add-hours");
                          }}
                          className="attendance-hours-input w-16 bg-transparent px-2 py-1.5 text-right text-xs text-secondary-900 outline-none placeholder:text-secondary-300"
                        />
                        <button
                          type="button"
                          onClick={() => postAction(m, "add-hours", -1)}
                          disabled={saving !== null || !hours[m.id]}
                          className="inline-flex h-7 w-7 items-center justify-center border-l border-secondary-300 text-red-700 transition-colors hover:bg-red-100 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Subtract hours from ${m.displayName}`}
                        >
                          {saving === `${m.id}:subtract` ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Minus size={14} />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => postAction(m, "add-hours")}
                          disabled={saving !== null || !hours[m.id]}
                          className="inline-flex h-7 w-7 items-center justify-center border-l border-secondary-300 text-primary-600 transition-colors hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Add hours for ${m.displayName}`}
                        >
                          {saving === `${m.id}:add` ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Plus size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
